import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publicLessonNotesResponse} from '../src/notes.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const text='Study notes about how to derive the chain rule correctly. Begin with the outer function, then apply the inner derivative. Repeat examples for understanding and never submit copied answers as coursework.';

test('notes response is text/plain, download-only, and excludes student credentials',async()=>{
  const response=publicLessonNotesResponse({id:'some\r\nInjected:filename',title:'Algebra\r\nLearning',description:'Short intro',lessonText:text,status:'published',creatorEmail:'private@school.test'});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/^text\/plain/);
  assert.match(response.headers.get('content-disposition'),/^attachment; filename="lesson-[a-zA-Z0-9_-]+\.txt"$/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
  const value=await response.text();assert.match(value,/Algebra/);assert.match(value,/Study notes about/);
  assert.doesNotMatch(value,/private@school\.test|Injected:filename/);
});
test('notes export is never produced for drafts, rejected, missing or empty lessons',()=>{
  for(const item of [null,{status:'draft',lessonText:text},{status:'rejected',lessonText:text},{status:'in_review',lessonText:text},{status:'published',lessonText:''}]){
    assert.throws(()=>publicLessonNotesResponse(item),{message:'LESSON_NOT_FOUND'});
  }
});
test('HTTP notes endpoint denies unpublished lessons, permits approved lessons, ignores cookie spoofing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'campus-notes-'));const store=openLocalStore(join(dir,'campus.sqlite'));
 try{
  store.bootstrapAdmin('admin@notes.test','A Strong Secret Admin Password 2026');
  const handle=createLocalHandler(store);
  async function api(path,method='GET',payload,token){
    const req=new Request('http://localhost:3000/api/local/'+path,{method,
      headers:{...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),...(token?{cookie:`campus_local_session=${token}`}:{})},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    return handle(req,path.split('/'));
  }
  const adminLogin=await api('auth/login','POST',{email:'admin@notes.test',password:'A Strong Secret Admin Password 2026'});
  const admin=adminLogin.headers.get('set-cookie').match(/campus_local_session=([^;]+)/)[1];
  const school=(await (await api('admin/institutions','POST',{name:'Note Campus'},admin)).json()).institution.id;
  const course=(await (await api('admin/courses','POST',{institutionId:school,code:'NOT101',title:'Notes 101'},admin)).json()).course.id;
  const user=(await (await api('auth/register','POST',{email:'creator@notes.test',password:'A Strong Student Password 2026',institutionId:school})).json()).user.id;
  await api('admin/verify','POST',{userId:user},admin);
  const studentLogin=await api('auth/login','POST',{email:'creator@notes.test',password:'A Strong Student Password 2026'});
  const student=studentLogin.headers.get('set-cookie').match(/campus_local_session=([^;]+)/)[1];
  const created=await api('lessons/drafts','POST',{courseId:course,title:'My original mathematics notes',description:'Helpful method',previewText:'Step by step learning',lessonText:text,rightsAttested:true,creationKey:'notes-unique-key-2026-1234'},student);
  assert.equal(created.status,201);const lesson=(await created.json()).lesson.id;
  assert.equal((await api('lessons/'+lesson+'/notes')).status,404);
  assert.equal((await api('lessons/'+lesson+'/notes','GET',undefined,student)).status,404);
  assert.equal((await api('lessons/'+lesson+'/notes','GET',undefined,admin)).status,404);
  await api('lessons/'+lesson+'/submit','POST',{},student);
  assert.equal((await api('lessons/'+lesson+'/notes')).status,404);
  const approval=await api('lessons/'+lesson+'/review','POST',{decision:'approve',reason:'Original permitted educational notes'},admin);
  assert.equal(approval.status,200);
  const published=await api('lessons/'+lesson+'/notes');assert.equal(published.status,200);
  assert.match(published.headers.get('content-disposition'),/attachment;/);
  assert.match(await published.text(),/My original mathematics notes/);
  const missing=await api('lessons/missing-lesson-id/notes');assert.equal(missing.status,404);
  assert.equal((await api('lessons/'+lesson+'/notes','POST',{},student)).status!==200,true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('inactive or missing parent course cannot export a previously approved lesson',async()=>{
  const lesson={id:'visible-id',courseId:'course-id',status:'published',title:'Approved',lessonText:text};
  const stub={getSession:()=>null,publicLesson:()=>lesson,getCourse:()=>({active:false})};
  const response=await createLocalHandler(stub)(new Request('http://localhost:3000/api/local/lessons/visible-id/notes'),['lessons','visible-id','notes']);
  assert.equal(response.status,404);
  assert.equal((await response.json()).error,'LESSON_NOT_FOUND');
});
