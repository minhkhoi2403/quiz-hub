import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizText, isCorrect, appendQuestions } from '../public/question-utils.js';
import { validateQuestions } from '../server/validation.js';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

test('Japanese dialogue stays in the prompt with document heading and separators', () => {
  const dialogue = 'A: マルコさん、やさいを（　　　）。B: はい、わかりました。';
  for (const conversation of [dialogue, dialogue.replace('B:', '\nB:')]) {
    const { questions, warnings } = parseQuizText(`TỔNG HỢP CÂU HỎI ÔN TẬP JPD123
Câu 1: Chọn trong A. B. C. D đáp án thích hợp để điền vào chỗ trống:
${conversation}
A. あらいましたか
B. あらいますか
C. あらいませんか
D. あらってください
Đáp án: D. あらってください
__________________________________________________
Câu 2: Chọn?
A. Một
B. Hai
Đáp án: B. Hai
__________________________________________________`);
    assert.equal(questions.length, 2);
    assert.equal(questions[0].text, `Chọn trong A. B. C. D đáp án thích hợp để điền vào chỗ trống:\n${conversation}`);
    assert.deepEqual(questions[0].options, ['あらいましたか', 'あらいますか', 'あらいませんか', 'あらってください']);
    assert.equal(questions[0].answer, 3);
    assert.equal(questions[1].answer, 1);
    assert.deepEqual(warnings, []);
    assert.equal(validateQuestions(questions).length, 2);
  }
});

test('colon choices remain supported and conflicting answer text requires review', () => {
  assert.equal(parseQuizText('Câu 1: Chọn?\nA: Một\nB: Hai\nĐáp án: B').questions[0].answer, 1);
  for (const key of ['B. Một', 'D. Hai', 'B. Hai hoặc Một', '']) {
    const parsed = parseQuizText(`Câu 1: Chọn?\nA. Một\nB. Hai\nĐáp án: ${key}`);
    assert.equal(parsed.questions[0].answer, null);
    assert.equal(parsed.warnings.length, 1);
  }
  assert.throws(() => parseQuizText('Câu 1: Chọn?\nA: Hội thoại\nB: Hội thoại\nA. Một\nC. Hai'), /liên tiếp/);
  assert.equal(parseQuizText('Câu 1: Chọn?\nA. Một\nB. Hai\nĐáp án:\nĐáp án: B').questions[0].answer, null);
});

test('offline parser keeps multiple answers and flags ambiguous answer prose', () => {
  const parsed = parseQuizText('Question 1: Select two.\nA. First\ncontinued\nB. Second\nC. Third\nAnswer: AC\nQuestion 2: Unknown?\nA. Yes\nB. No\nAnswer: Not specified (A / B)');
  assert.deepEqual(parsed.questions[0].answer, [0, 2]);
  assert.equal(parsed.questions[0].options[0], 'First\ncontinued');
  assert.equal(parsed.questions[1].answer, null);
  assert.equal(parsed.warnings.length, 1);
  assert.throws(() => validateQuestions(parsed.questions), /câu 2/);
  assert.ok(isCorrect([2, 0], [0, 2]));
  assert.ok(!isCorrect([0], [0, 2]));
  assert.ok(!isCorrect([0, 1, 2], [0, 2]));
});
test('Vietnamese labels, standalone letters, explanation, and malformed inputs', () => {
  const { questions } = parseQuizText('Câu 1: Chọn?\r\nA\r\nMột\r\nB\r\nHai\r\nĐáp án: B\r\nGiải thích: Hai đúng');
  assert.deepEqual(questions[0], { text: 'Chọn?', options: ['Một', 'Hai'], answer: 1, explanation: 'Hai đúng', sourceAnswer: '' });
  assert.throws(() => parseQuizText('No questions'), /bắt đầu/);
  assert.throws(() => parseQuizText('Question 1: Test?\nA. X\nC. Y'), /liên tiếp/);
  assert.equal(parseQuizText('Câu 1: Test?\nA. X\nB. Y\nAnswer: D').questions[0].answer, null);
  assert.throws(() => validateQuestions([{text:'test',options:['a','b'],answer:[]}]), /đáp án/);
});
test('five 100-question imports accumulate to 500; overflow preserves existing questions', () => {
  const block = i => `Question ${i}: Test ${i}?\nA. Yes\nB. No\nAnswer: A`;
  let questions = [];
  for (let batch = 0; batch < 5; batch++) {
    const incoming = parseQuizText(Array.from({length:100}, (_, i) => block(batch * 100 + i + 1)).join('\n')).questions;
    questions = appendQuestions(questions, incoming);
  }
  assert.equal(validateQuestions(questions).length, 500);
  assert.equal(questions[0].text, 'Test 1?');
  assert.equal(questions[499].text, 'Test 500?');
  assert.throws(() => appendQuestions(questions, [questions[0]]), /chỉ còn chỗ cho 0 câu/);
  assert.equal(questions.length,500);
  assert.throws(() => validateQuestions([...questions, questions[0]]), /500/);
  assert.throws(() => parseQuizText(Array.from({length:101}, (_, i) => block(i+1)).join('\n')), /Mỗi lần dán tối đa 100/);
});
test('multi-answer quiz stores and grades exact sets with old single-answer compatibility', async () => {
  const db = await openDatabase({ file: ':memory:', url: '', postgres: false });
  const server = createApp(db).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`; let cookie;
  const request = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', ...(cookie ? { Cookie:cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return { status:r.status, data:await r.json() }; };
  try {
    await request('/auth/register', { name:'Test', email:'multiple@example.test', password:'password123' });
    const semester = (await request('/semesters',{name:'Test'})).data.id;
    const subject = (await request('/subjects',{name:'Test',semester_id:semester})).data.id;
    const questions = parseQuizText('Question 1: Select two\nA. X\nB. Y\nC. Z\nAnswer: AC\nQuestion 2: Select one\nA. X\nB. Y\nAnswer: B').questions;
    const lesson = (await request('/lessons',{name:'Test',subject_id:subject,questions})).data.id;
    const attempt = (await request('/attempts',{lesson_id:lesson})).data;
    assert.equal(attempt.questions[0].multiple,true); assert.equal(attempt.questions[0].answer,undefined);
    assert.equal((await request(`/attempts/${attempt.id}/answer`,{index:0,choice:[2,0]})).data.score,1);
    assert.equal((await request(`/attempts/${attempt.id}/answer`,{index:1,choice:1})).data.score,2);
    assert.equal((await request(`/attempts/${attempt.id}/finish`,{})).data.score,2);
    const second = (await request('/attempts',{lesson_id:lesson})).data;
    assert.equal((await request(`/attempts/${second.id}/answer`,{index:0,choice:[0]})).data.score,0);
    assert.equal((await request(`/attempts/${second.id}/answer`,{index:1,choice:[0,1]})).status,400);
    const large = Array.from({length:500}, (_, i) => ({...questions[0],text:`Question ${i+1}`}));
    const created = await request('/lessons',{name:'500 questions',subject_id:subject,questions:large});
    assert.equal(created.status,201);
    const loaded = (await request(`/lessons/${created.data.id}`)).data;
    assert.equal(loaded.questions.length,500);
    const saved = await fetch(base + `/lessons/${created.data.id}`, {method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({name:'Updated 500',questions:loaded.questions})});
    assert.equal(saved.status,200);
    const bigAttempt = (await request('/attempts',{lesson_id:created.data.id})).data;
    assert.equal(bigAttempt.total,500);
    assert.equal((await request(`/attempts/${bigAttempt.id}/answer`,{index:499,choice:[0,2]})).data.score,1);
    assert.equal((await request('/lessons',{name:'Too many',subject_id:subject,questions:[...large,large[0]]})).status,400);
    const shuffled = (await request('/attempts',{lesson_id:created.data.id,shuffle:true})).data;
    assert.deepEqual(shuffled.questions.map(q=>q.text).sort(), large.map(q=>q.text).sort());
    assert.ok(shuffled.questions.every(q=>q.answer===undefined));
    const resumed = (await request(`/attempts/${shuffled.id}`)).data;
    assert.deepEqual(resumed.questions,shuffled.questions);
    assert.equal((await request(`/attempts/${shuffled.id}/answer`,{index:0,choice:[2,0]})).data.score,1);
    const original = (await request(`/lessons/${created.data.id}`)).data;
    assert.deepEqual(original.questions.map(q=>q.text),large.map(q=>q.text));
    assert.equal((await request('/attempts',{lesson_id:created.data.id,shuffle:'true'})).status,400);
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); }
});
