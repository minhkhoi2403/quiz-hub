import { MAX_LESSON_QUESTIONS } from '../public/question-utils.js';
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function text(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} phải có từ 1 đến ${max} ký tự.`);
  return value.trim();
}
export function validateQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_LESSON_QUESTIONS) fail('Mỗi bài cần từ 1 đến 500 câu hỏi.');
  return input.map((q, index) => {
    const stem = text(q?.text, `Câu ${index + 1}`, 6000);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) fail(`Câu ${index + 1} cần 2–8 lựa chọn.`);
    const options = q.options.map(o => text(o, 'Lựa chọn', 3000));
    const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
    if (!answers.length || new Set(answers).size !== answers.length || answers.some(a => !Number.isInteger(a) || a < 0 || a >= options.length)) fail(`Chọn đáp án đúng cho câu ${index + 1}.`);
    return { text: stem, options, answer: q.answer, explanation: typeof q.explanation === 'string' ? q.explanation.trim().slice(0, 6000) : '' };
  });
}
