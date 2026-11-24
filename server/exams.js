import { randomUUID } from 'node:crypto';
import { fail } from './validation.js';
import { answerList, isCorrect } from '../public/question-utils.js';
import { shuffleQuestions } from './shuffle.js';

export function subjectPool(lessons) {
  const unique = new Map();
  for (const lesson of lessons) for (const q of JSON.parse(lesson.questions)) {
    const key = JSON.stringify([q.text.trim(), q.options, [...answerList(q.answer)].sort()]);
    if (!unique.has(key)) unique.set(key, q);
  }
  return [...unique.values()];
}

export function installExams(app, db, { nowMs = Date.now } = {}) {
  const now = () => new Date(nowMs()).toISOString();
  async function expire(user) {
    await db.query('UPDATE exams SET finished_at=deadline,version=version+1 WHERE user_id=$1 AND finished_at IS NULL AND deadline<=$2', [user, now()]);
  }
  async function get(id, user) {
    await expire(user);
    const [row] = await db.query('SELECT * FROM exams WHERE id=$1 AND user_id=$2', [id, user]);
    if (!row) fail('Không tìm thấy bài thi.', 404);
    return row;
  }
  function view(row) {
    const qs = JSON.parse(row.questions), answers = JSON.parse(row.answers), finished = Boolean(row.finished_at);
    return { id:row.id, mode:'exam', subject_id:row.subject_id, lesson_name:`Thi thử · ${row.subject_name}`, started_at:row.started_at, deadline:row.deadline, finished_at:row.finished_at, server_now:now(), answers, total:qs.length, answered:Object.keys(answers).length,
      score:finished ? qs.filter((q,i)=>isCorrect(answers[i],q.answer)).length : null,
      questions:qs.map(q=>finished ? q : { text:q.text,options:q.options,multiple:answerList(q.answer).length>1 }) };
  }
  app.get('/api/exam-subjects', async (req,res) => {
    const subjects = await db.query('SELECT s.* FROM subjects s JOIN semesters t ON s.semester_id=t.id WHERE t.user_id=$1 ORDER BY s.name',[req.user.id]);
    const lessons = await db.query('SELECT l.subject_id,l.questions FROM lessons l JOIN subjects s ON l.subject_id=s.id JOIN semesters t ON s.semester_id=t.id WHERE t.user_id=$1',[req.user.id]);
    res.json(subjects.map(s=>({...s,count:subjectPool(lessons.filter(l=>l.subject_id===s.id)).length})));
  });
  app.post('/api/exams', async (req,res) => {
    const {subject_id,count,minutes} = req.body;
    const [subject] = await db.query('SELECT s.* FROM subjects s JOIN semesters t ON s.semester_id=t.id WHERE s.id=$1 AND t.user_id=$2',[subject_id,req.user.id]);
    if (!subject) fail('Không tìm thấy môn học.',404);
    if (!Number.isInteger(count)||count<1||count>500) fail('Số câu thi phải từ 1 đến 500.');
    if (!Number.isInteger(minutes)||minutes<1||minutes>180) fail('Thời gian thi phải từ 1 đến 180 phút.');
    const pool = subjectPool(await db.query('SELECT questions FROM lessons WHERE subject_id=$1',[subject_id]));
    if(count>pool.length) fail(`Môn này có ${pool.length} câu không trùng. Hãy chọn số câu nhỏ hơn hoặc bằng ${pool.length}.`);
    const id=randomUUID(), started=now(), deadline=new Date(nowMs()+minutes*60000).toISOString();
    await db.query('INSERT INTO exams (id,user_id,subject_id,subject_name,questions,answers,started_at,deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,req.user.id,subject_id,subject.name,JSON.stringify(shuffleQuestions(pool).slice(0,count)),'{}',started,deadline]);
    res.status(201).json(view(await get(id,req.user.id)));
  });
  app.get('/api/exams',async(req,res)=>{
    await expire(req.user.id);
    const rows=await db.query('SELECT * FROM exams WHERE user_id=$1 ORDER BY started_at DESC LIMIT 200',[req.user.id]);
    res.json(rows.map(row=>{const {questions,answers,...summary}=view(row);return summary;}));
  });
  app.get('/api/exams/:id',async(req,res)=>res.json(view(await get(req.params.id,req.user.id))));
  app.post('/api/exams/:id/answer',async(req,res)=>{
    const row=await get(req.params.id,req.user.id);
    if(row.finished_at) return res.json(view(row));
    const qs=JSON.parse(row.questions),answers=JSON.parse(row.answers),{index,choice}=req.body;
    if(!Number.isInteger(index)||!qs[index]||(!Array.isArray(choice)&&!Number.isInteger(choice))) fail('Lựa chọn không hợp lệ.');
    const selected=answerList(choice);
    if(new Set(selected).size!==selected.length||selected.some(i=>!Number.isInteger(i)||i<0||i>=qs[index].options.length)||(answerList(qs[index].answer).length===1&&selected.length>1)) fail('Lựa chọn không hợp lệ.');
    if(selected.length) answers[index]=selected; else delete answers[index];
    const changed=await db.query('UPDATE exams SET answers=$1,version=version+1 WHERE id=$2 AND version=$3 AND finished_at IS NULL AND deadline>$4 RETURNING id',[JSON.stringify(answers),row.id,row.version,now()]);
    const latest=await get(row.id,req.user.id);
    if(!changed.length&&!latest.finished_at) fail('Bài thi vừa thay đổi ở tab khác. Mở lại bài để đồng bộ.',409);
    res.json(view(latest));
  });
  app.post('/api/exams/:id/finish',async(req,res)=>{
    const row=await get(req.params.id,req.user.id);
    await db.query('UPDATE exams SET finished_at=CASE WHEN deadline<$1 THEN deadline ELSE $1 END,version=version+1 WHERE id=$2 AND finished_at IS NULL',[now(),row.id]);
    res.json(view(await get(row.id,req.user.id)));
  });
}
