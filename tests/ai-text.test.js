import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { generateQuiz } from '../server/ai.js';

const sourceText = 'Câu 1: 2 + 3 bằng bao nhiêu?\nA. 4\nB. 5\nC. 6\nD. 7\nCâu 2: 1 + 1 = ?\nA. 2\nB. 3';
const questions = [
  { text: '2 + 3 bằng bao nhiêu?', options: ['4', '5', '6', '7'], answer: 1, explanation: 'Hai cộng ba bằng năm.' },
  { text: '1 + 1 = ?', options: ['2', '3'], answer: 0, explanation: 'Một cộng một bằng hai.' }
];
test('text-only AI request separates source from instructions and preserves varied option counts', async () => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-only';
  try {
    const result = await generateQuiz({ sourceText, prompt: '', count: 10, images: [], fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.input[0].content.length, 2);
      assert.ok(body.input[0].content[1].text.endsWith(sourceText));
      assert.match(body.instructions, /không ép theo số câu mong muốn/);
      assert.match(body.instructions, /Nếu nguồn có đáp án thì giữ đáp án đó/);
      return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ questions, warnings: [] }) }] }] }) };
    } });
    assert.deepEqual(result.questions.map(q => q.options.length), [4, 2]);
    assert.equal(result.questions[0].answer, 1);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test('multipart text-only route accepts Vietnamese source and rejects empty or oversized input', async () => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-only';
  const db = await openDatabase({ file: ':memory:', url: '', postgres: false });
  let received;
  const server = createApp(db, { generate: async args => { received = args; return { questions, warnings: [], sources: [] }; } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const auth = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Text test', email: 'text@test.example', password: 'test-password' }) });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const send = async text => { const form = new FormData(); form.append('sourceText', text); form.append('prompt', ''); form.append('count', '10'); return fetch(base + '/api/ai/generate', { method: 'POST', headers: { Cookie: cookie }, body: form }); };
    const response = await send(sourceText);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).questions, questions);
    assert.equal(received.sourceText, sourceText); assert.deepEqual(received.images, []);
    assert.equal((await send('   ')).status, 400);
    const longVietnamese = 'ế'.repeat(60000);
    assert.equal((await send(longVietnamese)).status, 200);
    assert.equal(received.sourceText, longVietnamese);
    assert.equal((await send('x'.repeat(60001))).status, 400);
    assert.equal((await db.query('SELECT * FROM lessons')).length, 0, 'AI preview must not automatically save a lesson');
  } finally {
    await new Promise(resolve => server.close(resolve)); await db.close();
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
  }
});
