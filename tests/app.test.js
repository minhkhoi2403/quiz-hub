import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { extractImages, generateQuiz } from '../server/ai.js';
import sharp from 'sharp';
import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db, server, base, alice, bob, semester, subject, lesson, attempt;
const questions = [
  { text: 'Hai cộng hai bằng bao nhiêu?', options: ['3', '4', '5', '6'], answer: 1, explanation: '2 + 2 = 4.' },
  { text: 'Nước có công thức hóa học là gì?', options: ['H2O', 'CO2'], answer: 0, explanation: 'Nước gồm hydro và oxy.' }
];
async function call(path, { method = 'GET', body, cookie = alice, headers = {} } = {}) {
  const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  db = await openDatabase({ file: ':memory:', url: '', postgres: false });
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });

test('unauthenticated requests are denied; registration creates secure cookie', async () => {
  assert.equal((await call('/library')).status, 401);
  const a = await call('/auth/register', { method: 'POST', body: { name: 'Alice', email: 'alice@example.test', password: ' password-123 ' } });
  assert.equal(a.status, 200); assert.ok(a.cookie); alice = a.cookie;
  const b = await call('/auth/register', { method: 'POST', body: { name: 'Bob', email: 'bob@example.test', password: 'password-456' } });
  bob = b.cookie;
  const rows = await db.query('SELECT password FROM users');
  assert.ok(rows.every(row => !row.password.includes('password')));
});
test('duplicate account and wrong password rejected; exact password including spaces works', async () => {
  assert.equal((await call('/auth/register', { method: 'POST', body: { name: 'Dup', email: 'ALICE@example.test', password: 'password-123' } })).status, 409);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'bad-password' } })).status, 401);
  const result = await call('/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: ' password-123 ' } });
  assert.equal(result.status, 200); alice = result.cookie;
});
test('cross-origin mutation is rejected', async () => {
  assert.equal((await call('/semesters', { method: 'POST', body: { name: 'Nope' }, headers: { Origin: 'https://evil.example' } })).status, 403);
});
test('create semester, subject and lesson with exact option counts', async () => {
  semester = (await call('/semesters', { method: 'POST', body: { name: 'Học kỳ 1' } })).data.id;
  subject = (await call('/subjects', { method: 'POST', body: { name: 'Khoa học', semester_id: semester } })).data.id;
  const created = await call('/lessons', { method: 'POST', body: { name: 'Bài 1', subject_id: subject, questions } });
  assert.equal(created.status, 201); lesson = created.data.id;
  const found = (await call(`/lessons/${lesson}`)).data;
  assert.deepEqual(found.questions.map(q => q.options.length), [4, 2]);
  assert.equal((await call('/library')).data.lessons[0].count, 2);
});
test('other user cannot read, edit, delete, or attach to private hierarchy', async () => {
  assert.equal((await call('/library', { cookie: bob })).data.lessons.length, 0);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(`/lessons/${lesson}`, { method, cookie: bob, body: method === 'PUT' ? { name: 'Bad', questions } : undefined })).status, 404);
  assert.equal((await call('/subjects', { method: 'POST', cookie: bob, body: { name: 'Bad', semester_id: semester } })).status, 404);
  assert.equal((await call('/lessons', { method: 'POST', cookie: bob, body: { name: 'Bad', subject_id: subject, questions } })).status, 404);
  assert.equal((await call('/attempts', { method: 'POST', cookie: bob, body: { lesson_id: lesson } })).status, 404);
});
test('invalid answer index and empty options rejected', async () => {
  for (const q of [{ ...questions[0], answer: 4 }, { ...questions[0], options: ['A', ''] }]) {
    assert.equal((await call('/lessons', { method: 'POST', body: { name: 'Bad', subject_id: subject, questions: [q] } })).status, 400);
  }
});
test('attempt conceals solutions until answering, allows skip and review', async () => {
  const created = await call('/attempts', { method: 'POST', body: { lesson_id: lesson } });
  assert.equal(created.status, 201); attempt = created.data.id;
  assert.equal(created.data.questions[0].answer, undefined);
  assert.equal(created.data.questions[0].explanation, undefined);
  const second = await call(`/attempts/${attempt}/answer`, { method: 'POST', body: { index: 1, choice: 1 } });
  assert.equal(second.status, 200);
  assert.equal(second.data.questions[1].answer, 0);
  assert.equal(second.data.questions[0].answer, undefined);
  const first = await call(`/attempts/${attempt}/answer`, { method: 'POST', body: { index: 0, choice: 1 } });
  assert.equal(first.data.score, 1);
  const reload = await call(`/attempts/${attempt}`);
  assert.deepEqual(reload.data.answers, { 0: 1, 1: 1 });
  assert.equal((await call(`/attempts/${attempt}/answer`, { method: 'POST', body: { index: 0, choice: 0 } })).status, 409);
  assert.equal((await call(`/attempts/${attempt}`, { cookie: bob })).status, 404);
});
test('snapshot is preserved after lesson edit; finishing stores score', async () => {
  await call(`/lessons/${lesson}`, { method: 'PUT', body: { name: 'Bài đã sửa', questions: [{ ...questions[0], answer: 2 }] } });
  const result = await call(`/attempts/${attempt}/finish`, { method: 'POST' });
  assert.equal(result.data.total, 2); assert.equal(result.data.score, 1); assert.equal(result.data.lesson_name, 'Bài 1');
  assert.ok(result.data.finished_at);
  assert.equal((await call(`/attempts/${attempt}/answer`, { method: 'POST', body: { index: 0, choice: 2 } })).status, 409);
  assert.equal((await call('/attempts')).data[0].score, 1);
});
test('unfinished skipped questions count as wrong and become reviewable on finish', async () => {
  const created = (await call('/attempts', { method: 'POST', body: { lesson_id: lesson } })).data;
  const finished = (await call(`/attempts/${created.id}/finish`, { method: 'POST' })).data;
  assert.equal(finished.score, 0); assert.equal(finished.questions[0].answer, 2);
});
test('concurrent answers cannot silently overwrite progress', async () => {
  await call(`/lessons/${lesson}`, { method: 'PUT', body: { name: 'Bài 1', questions } });
  const created = (await call('/attempts', { method: 'POST', body: { lesson_id: lesson } })).data;
  const results = await Promise.all([0, 1].map(index => call(`/attempts/${created.id}/answer`, { method: 'POST', body: { index, choice: 1 } })));
  assert.ok(results.every(r => [200, 409].includes(r.status)));
  const stored = (await call(`/attempts/${created.id}`)).data;
  assert.equal(Object.keys(stored.answers).length, results.filter(r => r.status === 200).length);
});
test('image upload normalizes PNG and rejects fake files and invalid ZIP', async () => {
  const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const images = await extractImages([{ originalname: 'test.png', buffer }]);
  assert.match(images[0].data, /^data:image\/png;base64,/);
  await assert.rejects(extractImages([{ originalname: 'fake.png', buffer: Buffer.from('not an image') }]));
  await assert.rejects(extractImages([{ originalname: 'bad.zip', buffer: Buffer.from('not a zip') }]));
});
test('AI request uses image input and strict schema; keeps 4 options unchanged', async () => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-not-real';
  try {
    const result = await generateQuiz({ prompt: 'Trích câu hỏi', count: 10, images: [{ name: 'a.png', data: 'data:image/png;base64,abc' }], fetcher: async (url, req) => {
      const payload = JSON.parse(req.body);
      assert.equal(payload.store, false); assert.equal(payload.text.format.strict, true);
      assert.equal(payload.input[0].content[1].type, 'input_image');
      return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ questions: [questions[0]], warnings: [] }) }] }] }) };
    } });
    assert.equal(result.questions[0].options.length, 4); assert.equal(result.questions[0].answer, 1);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});
function makeZip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, buffer] of entries) {
    const filename = Buffer.from(name), compressed = deflateRawSync(buffer), crc = crc32(buffer);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(buffer.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, compressed);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(buffer.length, 24); cd.writeUInt16LE(filename.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
test('ZIP reads nested images, ignores unrelated files and enforces image limits', async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const files = [['folder/1.png', png], ['folder/2.PNG', png], ['notes.txt', Buffer.from('ignore')]];
  const result = await extractImages([{ originalname: 'photos.zip', buffer: makeZip(files) }]);
  assert.deepEqual(result.map(i => i.name), ['folder/1.png', 'folder/2.PNG']);
  await assert.rejects(extractImages([{ originalname: 'empty.zip', buffer: makeZip([files[2]]) }]), /Không tìm thấy ảnh/);
  await assert.rejects(extractImages([{ originalname: 'many.zip', buffer: makeZip(Array.from({ length: 21 }, (_, i) => [`${i}.png`, png])) }]), /giới hạn/);
  await assert.rejects(extractImages([{ originalname: 'bomb.zip', buffer: makeZip([['large.png', Buffer.alloc(11 * 1024 * 1024)]]) }]), /giới hạn/);
});
test('SQLite data persists when the database is closed and reopened', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quizhub-test-'));
  const options = { url: '', postgres: false, file: join(dir, 'test.db') };
  try {
    const first = await openDatabase(options);
    await first.query('INSERT INTO users (id,name,email,password,created_at) VALUES ($1,$2,$3,$4,$5)', ['test-id', 'Test', 'test@local.test', 'hash', new Date().toISOString()]);
    await first.close();
    const second = await openDatabase(options);
    assert.equal((await second.query('SELECT name FROM users WHERE id=$1', ['test-id']))[0].name, 'Test');
    await second.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('deleting hierarchy cascades to lessons and attempts', async () => {
  assert.equal((await call(`/semesters/${semester}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await call('/library')).data, { semesters: [], subjects: [], lessons: [] });
  assert.deepEqual((await call('/attempts')).data, []);
});
test('logout invalidates the stored session', async () => {
  assert.equal((await call('/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await call('/me')).status, 401);
});
