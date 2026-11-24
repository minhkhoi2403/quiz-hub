import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextQuizAction, nextQuizLabel } from '../public/quiz-flow.js';
import { shuffleQuestions } from '../server/shuffle.js';

test('next checks a selection, keeps feedback visible, then advances on the next click', () => {
  const attempt = { total: 3, answers: {}, finished_at: null };
  assert.equal(nextQuizAction(attempt, 0, null), 'next');
  assert.equal(nextQuizLabel(attempt, 0, null), 'Bỏ qua / Câu sau');
  assert.equal(nextQuizAction(attempt, 0, 0), 'check');
  assert.equal(nextQuizAction(attempt, 0, [0,2]), 'check');
  assert.equal(nextQuizLabel(attempt, 0, [0,2]), 'Kiểm tra đáp án');
  attempt.answers[0] = [0,2];
  assert.equal(nextQuizAction(attempt, 0, null), 'next');
  assert.equal(nextQuizLabel(attempt, 0, null), 'Câu sau');
});
test('last question checks before finishing, while an unanswered last question may finish', () => {
  const attempt = { total:1, answers:{}, finished_at:null };
  assert.equal(nextQuizAction(attempt,0,[]),'finish');
  assert.equal(nextQuizAction(attempt,0,1),'check');
  attempt.answers[0] = 1;
  assert.equal(nextQuizAction(attempt,0,null),'finish');
  attempt.finished_at = '2026-11-15';
  assert.equal(nextQuizAction(attempt,0,null),'done');
});
test('shuffle moves entire questions without changing original order or options and solutions', () => {
  const questions = Array.from({length:5}, (_,i)=>({text:`Q${i}`,options:['A','B','C'],answer:i%3}));
  const shuffled = shuffleQuestions(questions, () => 0);
  assert.deepEqual(questions.map(q=>q.text),['Q0','Q1','Q2','Q3','Q4']);
  assert.deepEqual(shuffled.map(q=>q.text),['Q1','Q2','Q3','Q4','Q0']);
  for (const q of shuffled) assert.equal(q,questions.find(original=>original.text===q.text));
  assert.deepEqual(shuffleQuestions([]),[]);
  assert.deepEqual(shuffleQuestions([questions[0]]),[questions[0]]);
});
