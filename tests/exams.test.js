import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { subjectPool } from '../server/exams.js';

let db, server, base, alice, bob, subject, otherSubject, lesson, clock=Date.parse('2026-11-16T00:00:00Z');
const qs=Array.from({length:4},(_,i)=>({text:`Question ${i}`,options:['One','Two','Three'],answer:i===3?[0,2]:i%3,explanation:'Private solution'}));
async function call(path,body,cookie=alice,method=body?'POST':'GET'){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
before(async()=>{
  db=await openDatabase({file:':memory:',url:'',postgres:false});
  server=createApp(db,{nowMs:()=>clock}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;
  alice=(await call('/auth/register',{name:'Alice',email:'exam-a@example.test',password:'password123'})).cookie;
  bob=(await call('/auth/register',{name:'Bob',email:'exam-b@example.test',password:'password123'})).cookie;
  const semester=(await call('/semesters',{name:'Semester'})).data.id;
  subject=(await call('/subjects',{name:'Exam subject',semester_id:semester})).data.id;
  otherSubject=(await call('/subjects',{name:'Other',semester_id:semester})).data.id;
  lesson=(await call('/lessons',{name:'Lesson 1',subject_id:subject,questions:qs.slice(0,2)})).data.id;
  await call('/lessons',{name:'Lesson 2',subject_id:subject,questions:[...qs.slice(1)]});
  await call('/lessons',{name:'Excluded',subject_id:otherSubject,questions:[{...qs[0],text:'Wrong subject'}]});
});
after(async()=>{await new Promise(r=>server.close(r));await db.close();});
test('exam pools merge all lessons of a subject, deduplicate identical questions and isolate users',async()=>{
  assert.equal(subjectPool([{questions:JSON.stringify(qs)},{questions:JSON.stringify(qs)}]).length,4);
  const subjects=(await call('/exam-subjects')).data;
  assert.equal(subjects.find(s=>s.id===subject).count,4);
  assert.deepEqual((await call('/exam-subjects',undefined,bob)).data,[]);
  assert.equal((await call('/exams',{subject_id:subject,count:1,minutes:10},bob)).status,404);
});
test('exam configuration validates count and duration against the actual pool',async()=>{
  for(const settings of [{count:0,minutes:10},{count:5,minutes:10},{count:2.5,minutes:10},{count:2,minutes:0},{count:2,minutes:181},{count:2,minutes:1.5}])assert.equal((await call('/exams',{subject_id:subject,...settings})).status,400);
});
test('random exam snapshot conceals solutions and score until final submission; answers remain editable',async()=>{
  const r=await call('/exams',{subject_id:subject,count:4,minutes:30});assert.equal(r.status,201);const exam=r.data;
  assert.equal(Date.parse(exam.deadline)-Date.parse(exam.started_at),30*60000);
  assert.deepEqual(exam.questions.map(q=>q.text).sort(),qs.map(q=>q.text).sort());
  assert.equal(exam.score,null);assert.ok(exam.questions.every(q=>q.answer===undefined&&q.explanation===undefined));
  assert.equal((await call(`/exams/${exam.id}`,undefined,bob)).status,404);
  assert.equal((await call(`/exams/${exam.id}/answer`,{index:0,choice:0},bob)).status,404);
  assert.equal((await call(`/exams/${exam.id}/finish`,{},bob)).status,404);
  for(let i=0;i<exam.total;i++){
    const expected=qs.find(q=>q.text===exam.questions[i].text).answer;
    let result=(await call(`/exams/${exam.id}/answer`,{index:i,choice:expected})).data;
    assert.equal(result.score,null);assert.equal(result.questions[i].answer,undefined);assert.equal(result.questions[i].explanation,undefined);
    result=(await call(`/exams/${exam.id}/answer`,{index:i,choice:[]})).data;assert.equal(result.answers[i],undefined);
    await call(`/exams/${exam.id}/answer`,{index:i,choice:expected});
  }
  assert.equal((await call('/exams')).data.find(a=>a.id===exam.id).score,null);
  const resumed=(await call(`/exams/${exam.id}`)).data;assert.deepEqual(resumed.questions,exam.questions);assert.equal(resumed.deadline,exam.deadline);
  const finished=(await call(`/exams/${exam.id}/finish`,{})).data;assert.equal(finished.score,4);assert.ok(finished.questions.every(q=>q.answer!==undefined));
  const locked=(await call(`/exams/${exam.id}/answer`,{index:0,choice:[]})).data;assert.deepEqual(locked.answers,finished.answers);assert.equal(locked.score,4);
});
test('server enforces expiry after leaving the page and rejects late answers without changing score',async()=>{
  const exam=(await call('/exams',{subject_id:subject,count:2,minutes:1})).data;
  const expected=qs.find(q=>q.text===exam.questions[0].text).answer;
  await call(`/exams/${exam.id}/answer`,{index:0,choice:expected});
  clock+=60001;
  const late=(await call(`/exams/${exam.id}/answer`,{index:1,choice:0})).data;
  assert.equal(late.finished_at,exam.deadline);assert.equal(late.answers[1],undefined);assert.equal(late.score,1);
  const history=(await call('/exams')).data.find(a=>a.id===exam.id);assert.equal(history.finished_at,exam.deadline);assert.equal(history.score,1);
  const second=(await call('/exams',{subject_id:subject,count:1,minutes:1})).data;
  clock+=60000;
  assert.equal((await call('/exams')).data.find(a=>a.id===second.id).finished_at,second.deadline);
});
test('exam snapshot survives lesson edits and deletion without losing its subject history',async()=>{
  const exam=(await call('/exams',{subject_id:subject,count:4,minutes:1})).data;
  await call(`/lessons/${lesson}`,{name:'Changed',questions:[{...qs[0],text:'Changed question'}]},alice,'PUT');
  await call(`/lessons/${lesson}`,undefined,alice,'DELETE');
  assert.deepEqual((await call(`/exams/${exam.id}`)).data.questions,exam.questions);
  const finished=(await call(`/exams/${exam.id}/finish`,{})).data;assert.equal(finished.score,0);assert.equal(finished.total,4);
});
