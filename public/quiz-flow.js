import { answerList } from './question-utils.js';

export function nextQuizAction(attempt, index, choice) {
  if (!attempt.finished_at && attempt.answers[index] === undefined && answerList(choice).length) return 'check';
  if (index < attempt.total - 1) return 'next';
  return attempt.finished_at ? 'done' : 'finish';
}

export function nextQuizLabel(attempt, index, choice) {
  const action = nextQuizAction(attempt, index, choice);
  if (action === 'check') return 'Kiểm tra đáp án';
  if (action === 'finish' || action === 'done') return 'Kết thúc bài';
  return !attempt.finished_at && attempt.answers[index] === undefined ? 'Bỏ qua / Câu sau' : 'Câu sau';
}
