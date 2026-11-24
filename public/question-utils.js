export const MAX_LESSON_QUESTIONS = 500;
export const MAX_IMPORT_QUESTIONS = 100;
export function appendQuestions(existing, incoming) {
  if (existing.length + incoming.length > MAX_LESSON_QUESTIONS) throw new Error(`Bài đang có ${existing.length} câu, chỉ còn chỗ cho ${MAX_LESSON_QUESTIONS - existing.length} câu. Mỗi bài tối đa ${MAX_LESSON_QUESTIONS} câu.`);
  return [...existing, ...incoming];
}
export const answerList = value => Array.isArray(value) ? value : Number.isInteger(value) ? [value] : [];
export const hasAnswer = (value, index) => answerList(value).includes(index);
export const answerLabel = value => answerList(value).map(i => String.fromCharCode(65 + i)).join(', ');
export const isCorrect = (choice, answer) => {
  const expected = answerList(answer), selected = answerList(choice);
  return expected.length > 0 && expected.length === selected.length && expected.every(i => selected.includes(i));
};

export function parseQuizText(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Hãy dán đề vào ô văn bản.');
  if (source.length > 200000) throw new Error('Tối đa 200.000 ký tự mỗi lần nhập.');
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let current;
  for (const line of lines) {
    const match = line.trim().match(/^(?:Question|Câu)\s*(\d+)\s*[:.)-]\s*(.*)$/i);
    if (match) { current = { number: match[1], text: match[2], lines: [] }; blocks.push(current); }
    else if (current) current.lines.push(line.trim());
    // Text before the first question is the document heading, not a question.
  }
  if (!blocks.length) throw new Error('Đề cần bắt đầu bằng “Question 1:” hoặc “Câu 1:”. Không tìm thấy câu hỏi.');
  if (blocks.length > MAX_IMPORT_QUESTIONS) throw new Error('Mỗi lần dán tối đa 100 câu. Hãy tách thành nhiều đợt để thêm vào cùng bài (tối đa 500 câu/bài).');
  const warnings = [];
  const questions = blocks.map(block => {
    // Prefer explicit choice labels over speaker labels such as A: / B:.
    // Only inspect the question/options area; explanations can also contain lists.
    const metadataStart = block.lines.findIndex(line => /^(?:Answer|Correct answer|Đáp án|Explanation|Giải thích)(?:\s+đúng)?\s*:/i.test(line));
    const body = metadataStart < 0 ? block.lines : block.lines.slice(0, metadataStart);
    const explicitChoices = body.some(line => /^A(?:[.)]\s*|\s*$)/.test(line));
    const optionPattern = explicitChoices ? /^([A-H])(?:[.)]\s*|\s*$)(.*)$/ : /^([A-H])(?:[.):]\s*|\s*$)(.*)$/;
    const options = []; let answerText = '', explanation = '', target = 'text', invalid = false;
    for (const line of block.lines) {
      if (!line) continue;
      if ((target === 'answer' || target === 'explanation') && /^(?:_{3,}|-{3,}|─{3,})$/.test(line)) continue;
      const answer = line.match(/^(?:Answer|Correct answer|Đáp án)(?:\s+đúng)?\s*:\s*(.*)$/i);
      const explain = line.match(/^(?:Explanation|Giải thích)\s*:\s*(.*)$/i);
      const option = line.match(optionPattern);
      if (answer) { if (target === 'answer' || answerText) invalid = true; answerText = answer[1]; target = 'answer'; }
      else if (explain) { explanation = explain[1]; target = 'explanation'; }
      else if (option && target !== 'answer' && target !== 'explanation') {
        if (option[1].charCodeAt(0) - 65 !== options.length) throw new Error(`Câu ${block.number}: nhãn lựa chọn phải liên tiếp A, B, C…`);
        options.push(option[2]); target = 'option';
      } else if (target === 'option') options[options.length - 1] += '\n' + line;
      else if (target === 'answer') answerText += ' ' + line;
      else if (target === 'explanation') explanation += '\n' + line;
      else block.text += '\n' + line;
    }
    if (!block.text.trim() || options.length < 2 || options.some(o => !o.trim())) throw new Error(`Câu ${block.number}: cần nội dung đề và ít nhất 2 lựa chọn có nội dung.`);
    let answer = null;
    // A labelled answer with text is safe only when the text matches that choice.
    const labelledAnswer = answerText.trim().match(/^([A-H])[.):]\s*(\S[\s\S]*)$/i);
    const normalize = text => text.trim().replace(/\s+/g, ' ');
    if (!invalid && labelledAnswer) {
      const index = labelledAnswer[1].toUpperCase().charCodeAt(0) - 65;
      if (index < options.length && normalize(labelledAnswer[2]) === normalize(options[index])) answer = index;
    }
    // Only accept an unambiguous answer key, never infer from prose or explanations.
    if (!invalid && /^[A-H](?:[A-H]|[\s,;/&]+[A-H])*\s*$/i.test(answerText.trim())) {
      const indices = [...new Set(answerText.toUpperCase().match(/[A-H]/g).map(c => c.charCodeAt(0) - 65))].sort();
      if (indices.every(i => i < options.length)) answer = indices.length === 1 ? indices[0] : indices;
    }
    if (answer === null) warnings.push(`Câu ${block.number}: đáp án thiếu hoặc không rõ${answerText ? ` (${answerText})` : ''}. Hãy chọn đáp án đúng trước khi lưu.`);
    return { text: block.text.trim(), options: options.map(o => o.trim()), answer, explanation, sourceAnswer: answer === null ? answerText : '' };
  });
  return { questions, warnings };
}
