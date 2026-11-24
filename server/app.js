import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fail, text, validateQuestions } from './validation.js';
import { extractImages, generateQuiz } from './ai.js';
import { answerList, isCorrect } from '../public/question-utils.js';
import { shuffleQuestions } from './shuffle.js';
import { installExams } from './exams.js';
const scrypt = promisify(scryptCallback);
const now = () => new Date().toISOString();
const hash = token => createHash('sha256').update(token).digest('hex');
const parse = value => JSON.parse(value);
const boundedStorage = {
  _handleFile(req, file, callback) {
    const chunks = []; let size = 0, done = false;
    const finish = (err, result) => { if (!done) { done = true; callback(err, result); } };
    file.stream.on('data', chunk => {
      req.uploadBytes = (req.uploadBytes || 0) + chunk.length; size += chunk.length;
      if (req.uploadBytes > MAX_UPLOAD) { chunks.length = 0; file.stream.destroy(Object.assign(new Error('Tổng tệp tải lên tối đa 30 MB.'), { status: 413 })); }
      else chunks.push(chunk);
    });
    file.stream.on('error', error => finish(error));
    file.stream.on('end', () => finish(null, { buffer: Buffer.concat(chunks), size }));
  },
  _removeFile(req, file, callback) { delete file.buffer; callback(null); }
};
const upload = multer({ storage: boundedStorage, limits: { fileSize: 10 * 1024 * 1024, files: 20, fields: 3, fieldSize: 240000, parts: 24 }, fileFilter: (req, file, cb) => cb(/\.(png|jpe?g|webp|zip)$/i.test(file.originalname) ? null : Object.assign(new Error('Chỉ hỗ trợ JPG, PNG, WebP và ZIP.'), { status: 400 }), true) });

export function createApp(db, { generate = generateQuiz, nowMs } = {}) {
  const app = express();
  const activeAI = new Set();
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'upgrade-insecure-requests': process.env.COOKIE_SECURE === 'true' ? [] : null } } }));
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/auth/register' || req.path === '/auth/login' || req.path === '/health') {
      return next();
    }
    const origin = req.get('origin');
    const secFetchSite = req.get('sec-fetch-site');
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).hostname.toLowerCase(); } catch {}

      const allowed = (process.env.APP_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
      const host = req.get('x-forwarded-host') || req.get('host') || '';
      const hostNameOnly = host.split(':')[0].toLowerCase();

      const isSameHost = originHost && (originHost === hostNameOnly || ((originHost === 'localhost' || originHost === '127.0.0.1') && (hostNameOnly === 'localhost' || hostNameOnly === '127.0.0.1')));
      const isTunnel = originHost.endsWith('.trycloudflare.com') || originHost.endsWith('.loca.lt') || originHost.endsWith('.ngrok-free.app') || originHost.endsWith('.ngrok.io');
      const isExplicitlyAllowed = allowed.includes(origin) || allowed.some(a => a.includes(originHost));

      if (isTunnel || isSameHost || isExplicitlyAllowed) {
        return next();
      }

      if (secFetchSite === 'cross-site' || !isSameHost) {
        return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
      }
    } else if (secFetchSite === 'cross-site') {
      return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    }
    next();
  });
  app.get('/api/health', async (req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok' }); });
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Quá nhiều lần đăng nhập. Hãy thử lại sau 15 phút.' } });
  async function session(req, res, user) {
    const token = randomBytes(32).toString('hex');
    await db.query('DELETE FROM sessions WHERE expires_at < $1', [now()]);
    await db.query('INSERT INTO sessions (token,user_id,expires_at) VALUES ($1,$2,$3)', [hash(token), user.id, new Date(Date.now() + 30 * 86400000).toISOString()]);
    res.cookie('qh_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role || 'user' } });
  }
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const name = text(req.body.name, 'Tên', 80), email = text(req.body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email không hợp lệ.');
    const password = req.body.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail('Mật khẩu cần từ 8 đến 128 ký tự.');
    const salt = randomBytes(16).toString('hex');
    const encoded = `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
    const userCountRows = await db.query('SELECT COUNT(*) as count FROM users');
    const isFirstUser = Number(userCountRows[0]?.count || 0) === 0;
    const role = isFirstUser || (process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user';
    const user = { id: randomUUID(), name, email, role };
    try { await db.query('INSERT INTO users (id,name,email,password,role,created_at) VALUES ($1,$2,$3,$4,$5,$6)', [user.id, name, email, encoded, role, now()]); }
    catch (e) { if (e.code === '23505' || e.message?.includes('UNIQUE constraint')) fail('Email này đã được đăng ký.', 409); throw e; }
    await session(req, res, user);
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const email = text(req.body.email, 'Email', 254).toLowerCase();
    const password = req.body.password;
    if (typeof password !== 'string' || !password.length || password.length > 128) fail('Mật khẩu không hợp lệ.');
    const [user] = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    const [salt, stored] = (user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const candidate = await scrypt(password, salt, 64);
    if (!user || !timingSafeEqual(candidate, Buffer.from(stored, 'hex'))) fail('Email hoặc mật khẩu không đúng.', 401);
    await session(req, res, user);
  });
  app.use('/api', async (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) {
      token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('qh_session='))?.slice(11);
    }
    if (!token) return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    const [user] = await db.query('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>$2', [hash(token), now()]);
    if (!user) return res.status(401).json({ error: 'Phiên đăng nhập hết hạn.' });
    req.user = user; req.sessionHash = hash(token); next();
  });
  app.get('/api/me', (req, res) => res.json({ user: req.user, aiEnabled: Boolean(process.env.OPENAI_API_KEY) }));
  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Bạn không có quyền quản trị.' });
    next();
  }
  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const users = await db.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users });
  });
  app.patch('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
    const role = String(req.body.role || '').toLowerCase();
    if (!['admin', 'user'].includes(role)) fail('Vai trò không hợp lệ.');
    if (req.params.id === req.user.id && role !== 'admin') fail('Không thể tự hạ quyền quản trị của chính mình.');
    await db.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    res.json({ ok: true });
  });
  app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    if (req.params.id === req.user.id) fail('Không thể xóa tài khoản của chính mình.');
    await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  });
  app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    const [users] = await db.query('SELECT COUNT(*) as count FROM users');
    const [lessons] = await db.query('SELECT COUNT(*) as count FROM lessons');
    const [attempts] = await db.query('SELECT COUNT(*) as count FROM attempts');
    const [exams] = await db.query('SELECT COUNT(*) as count FROM exams');
    res.json({
      totalUsers: Number(users?.count || 0),
      totalLessons: Number(lessons?.count || 0),
      totalAttempts: Number(attempts?.count || 0),
      totalExams: Number(exams?.count || 0)
    });
  });
  installExams(app, db, nowMs ? { nowMs } : {});
  app.post('/api/auth/logout', async (req, res) => { await db.query('DELETE FROM sessions WHERE token=$1', [req.sessionHash]); res.clearCookie('qh_session', { path: '/' }); res.json({ ok: true }); });
  async function owned(kind, id, user) {
    const sql = kind === 'semester' ? 'SELECT * FROM semesters WHERE id=$1 AND user_id=$2' : kind === 'subject' ? 'SELECT s.* FROM subjects s JOIN semesters t ON s.semester_id=t.id WHERE s.id=$1 AND t.user_id=$2' : 'SELECT l.* FROM lessons l JOIN subjects s ON l.subject_id=s.id JOIN semesters t ON s.semester_id=t.id WHERE l.id=$1 AND t.user_id=$2';
    const [row] = await db.query(sql, [id, user]); if (!row) fail('Không tìm thấy nội dung.', 404); return row;
  }
  app.get('/api/library', async (req, res) => {
    const semesters = await db.query('SELECT * FROM semesters WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    const subjects = await db.query('SELECT s.* FROM subjects s JOIN semesters t ON s.semester_id=t.id WHERE t.user_id=$1 ORDER BY s.created_at', [req.user.id]);
    const lessons = await db.query('SELECT l.* FROM lessons l JOIN subjects s ON l.subject_id=s.id JOIN semesters t ON s.semester_id=t.id WHERE t.user_id=$1 ORDER BY l.updated_at DESC', [req.user.id]);
    res.json({ semesters, subjects, lessons: lessons.map(({ questions, ...l }) => ({ ...l, count: parse(questions).length })) });
  });
  app.post('/api/semesters', async (req, res) => { const id = randomUUID(); await db.query('INSERT INTO semesters (id,user_id,name,created_at) VALUES ($1,$2,$3,$4)', [id, req.user.id, text(req.body.name, 'Tên học kỳ'), now()]); res.status(201).json({ id }); });
  app.post('/api/subjects', async (req, res) => { await owned('semester', req.body.semester_id, req.user.id); const id = randomUUID(); await db.query('INSERT INTO subjects (id,semester_id,name,created_at) VALUES ($1,$2,$3,$4)', [id, req.body.semester_id, text(req.body.name, 'Tên môn'), now()]); res.status(201).json({ id }); });
  app.post('/api/lessons', async (req, res) => {
    await owned('subject', req.body.subject_id, req.user.id);
    const id = randomUUID(), name = text(req.body.name, 'Tên bài'), questions = validateQuestions(req.body.questions);
    await db.query('INSERT INTO lessons (id,subject_id,name,description,questions,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, req.body.subject_id, name, String(req.body.description || '').slice(0, 2000), JSON.stringify(questions), now(), now()]); res.status(201).json({ id });
  });
  app.get('/api/lessons/:id', async (req, res) => { const l = await owned('lesson', req.params.id, req.user.id); res.json({ ...l, questions: parse(l.questions) }); });
  app.put('/api/lessons/:id', async (req, res) => { await owned('lesson', req.params.id, req.user.id); await db.query('UPDATE lessons SET name=$1,description=$2,questions=$3,updated_at=$4 WHERE id=$5', [text(req.body.name, 'Tên bài'), String(req.body.description || '').slice(0, 2000), JSON.stringify(validateQuestions(req.body.questions)), now(), req.params.id]); res.json({ ok: true }); });
  for (const [path, kind, table] of [['semesters', 'semester', 'semesters'], ['subjects', 'subject', 'subjects'], ['lessons', 'lesson', 'lessons']]) {
    app.delete(`/api/${path}/:id`, async (req, res) => { await owned(kind, req.params.id, req.user.id); await db.query(`DELETE FROM ${table} WHERE id=$1`, [req.params.id]); res.json({ ok: true }); });
    if (kind !== 'lesson') app.patch(`/api/${path}/:id`, async (req, res) => { await owned(kind, req.params.id, req.user.id); await db.query(`UPDATE ${table} SET name=$1 WHERE id=$2`, [text(req.body.name, 'Tên'), req.params.id]); res.json({ ok: true }); });
  }
  function attemptView(row) {
    const questions = parse(row.questions), answers = parse(row.answers);
    const score = questions.filter((q, i) => isCorrect(answers[i], q.answer)).length;
    return { ...row, answers, score, total: questions.length, questions: questions.map((q, i) => ({ ...(row.finished_at || answers[i] !== undefined ? q : { text: q.text, options: q.options }), multiple: answerList(q.answer).length > 1 })) };
  }
  async function attempt(id, user) { const [a] = await db.query('SELECT * FROM attempts WHERE id=$1 AND user_id=$2', [id, user]); if (!a) fail('Không tìm thấy lượt làm bài.', 404); return a; }
  app.post('/api/attempts', async (req, res) => {
    const lesson = await owned('lesson', req.body.lesson_id, req.user.id), id = randomUUID();
    if (req.body.shuffle !== undefined && typeof req.body.shuffle !== 'boolean') fail('Chế độ trộn câu hỏi không hợp lệ.');
    const questions = req.body.shuffle ? JSON.stringify(shuffleQuestions(parse(lesson.questions))) : lesson.questions;
    await db.query('INSERT INTO attempts (id,user_id,lesson_id,lesson_name,questions,answers,started_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, req.user.id, lesson.id, lesson.name, questions, '{}', now()]); res.status(201).json(attemptView(await attempt(id, req.user.id)));
  });
  app.get('/api/attempts', async (req, res) => { const rows = await db.query('SELECT * FROM attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 200', [req.user.id]); res.json(rows.map(a => { const v = attemptView(a); return { id: v.id, lesson_id: v.lesson_id, lesson_name: v.lesson_name, started_at: v.started_at, finished_at: v.finished_at, score: v.score, total: v.total, answered: Object.keys(v.answers).length }; })); });
  app.get('/api/attempts/:id', async (req, res) => res.json(attemptView(await attempt(req.params.id, req.user.id))));
  app.post('/api/attempts/:id/answer', async (req, res) => {
    const a = await attempt(req.params.id, req.user.id); if (a.finished_at) fail('Lượt làm bài đã kết thúc.', 409);
    const qs = parse(a.questions), answers = parse(a.answers), { index, choice } = req.body;
    const selected = answerList(choice);
    if (!Number.isInteger(index) || !qs[index] || !selected.length || new Set(selected).size !== selected.length || selected.some(c => !Number.isInteger(c) || c < 0 || c >= qs[index].options.length) || (answerList(qs[index].answer).length === 1 && selected.length !== 1)) fail('Lựa chọn không hợp lệ.');
    if (answers[index] !== undefined) fail('Câu đã được chấm. Hãy bắt đầu lượt mới nếu muốn làm lại.', 409);
    answers[index] = choice;
    const changed = await db.query('UPDATE attempts SET answers=$1,version=version+1 WHERE id=$2 AND version=$3 AND finished_at IS NULL RETURNING id', [JSON.stringify(answers), a.id, a.version]);
    if (!changed.length) fail('Tiến độ vừa thay đổi ở tab khác. Tải lại để tiếp tục.', 409);
    res.json(attemptView(await attempt(a.id, req.user.id)));
  });
  app.post('/api/attempts/:id/finish', async (req, res) => { const a = await attempt(req.params.id, req.user.id); await db.query('UPDATE attempts SET finished_at=$1,version=version+1 WHERE id=$2 AND finished_at IS NULL', [now(), a.id]); res.json(attemptView(await attempt(a.id, req.user.id))); });
  app.post('/api/ai/generate', rateLimit({ windowMs: 3600000, limit: 10, keyGenerator: req => req.user.id, message: { error: 'Mỗi tài khoản được tạo tối đa 10 lần mỗi giờ.' } }), (req, res, next) => {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Chưa cấu hình OPENAI_API_KEY trên server.' });
    if (activeAI.size >= 2 || activeAI.has(req.user.id)) return res.status(429).json({ error: 'AI đang xử lý yêu cầu khác. Vui lòng thử lại sau.' });
    if (Number(req.get('content-length') || 0) > MAX_UPLOAD + 300000) return res.status(413).json({ error: 'Tổng tệp tải lên tối đa 30 MB.' });
    activeAI.add(req.user.id);
    res.once('finish', () => activeAI.delete(req.user.id));
    res.once('close', () => activeAI.delete(req.user.id));
    next();
  }, upload.array('files', 20), async (req, res) => {
    const prompt = String(req.body.prompt || '').trim(); if (prompt.length > 10000) fail('Prompt tối đa 10.000 ký tự.');
    const sourceText = String(req.body.sourceText || '').replace(/\r\n?/g, '\n').trim();
    if (sourceText.length > 60000) fail('Văn bản nguồn tối đa 60.000 ký tự. Hãy chia thành các phần nhỏ hơn.');
    if (!prompt && !sourceText && !req.files?.length) fail('Hãy dán văn bản nguồn, nhập yêu cầu hoặc tải ảnh lên.');
    if ((req.files || []).reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD) fail('Tổng tệp tải lên tối đa 30 MB.');
    const count = Number(req.body.count || 10); if (!Number.isInteger(count) || count < 1 || count > 50) fail('Số câu cần từ 1 đến 50.');
    res.json(await generate({ prompt, sourceText, count, images: await extractImages(req.files || []) }));
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'API không tồn tại.' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((err, req, res, next) => {
    const status = err instanceof multer.MulterError ? 400 : err.status || 500;
    if (status >= 500) console.error('Request failed:', err.message);
    res.status(status).json({ error: err instanceof multer.MulterError ? 'Tệp vượt giới hạn: tối đa 10 MB/tệp, 20 tệp.' : status === 500 ? 'Có lỗi trên server. Vui lòng thử lại.' : err.message });
  });
  return app;
}
const MAX_UPLOAD = 30 * 1024 * 1024;
