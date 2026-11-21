import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const content='This original teaching explanation follows a related example, then checks every step. The objective is to build understanding and original notes rather than deliver a copied assessment for students to submit. It is intended as a general study resource with no confidential data.';
async function runWithData(fn){
 const directory=mkdtempSync(join(tmpdir(),'school-bookmark-'));const path=join(directory,'campus.sqlite');let store=openLocalStore(path);
 async function req(route,method='GET',body,token){
  const request=new Request('http://localhost:3000/api/local/'+route,{method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const r=await createLocalHandler(store)(request,route.split('/'));
  return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 }
 try{
  store.bootstrapAdmin('admin@bookmark.test','Strong Admin Password 2026');
  const a=(await req('auth/login','POST',{email:'admin@bookmark.test',password:'Strong Admin Password 2026'})).cookie;
  const school=(await req('admin/institutions','POST',{name:'Bookmark University'},a)).data.institution.id;
  const course=(await req('admin/courses','POST',{institutionId:school,code:'MTH 202',title:'Complex Calculus'},a)).data.course.id;
  const id1=(await req('auth/register','POST',{email:'c1@bookmark.test',password:'Strong Creator Password 2026',institutionId:school})).data.user.id;
  const id2=(await req('auth/register','POST',{email:'c2@bookmark.test',password:'Strong Student Password 2026',institutionId:school})).data.user.id;
  await req('admin/verify','POST',{userId:id1},a);await req('admin/verify','POST',{userId:id2},a);
  const c=(await req('auth/login','POST',{email:'c1@bookmark.test',password:'Strong Creator Password 2026'})).cookie;
  const p=(await req('auth/login','POST',{email:'c2@bookmark.test',password:'Strong Student Password 2026'})).cookie;
  const published=(await req('lessons/drafts','POST',{courseId:course,title:'Approved calculus explanation',description:'Original',previewText:'Worked steps',lessonText:content,rightsAttested:true,creationKey:'bookmark-public-001'},c)).data.lesson.id;
  const draft=(await req('lessons/drafts','POST',{courseId:course,title:'Hidden draft note',description:'Original',previewText:'Private',lessonText:content,rightsAttested:true,creationKey:'bookmark-private-001'},c)).data.lesson.id;
  await req('lessons/'+published+'/submit','POST',{},c);await req('lessons/'+published+'/review','POST',{decision:'approve',reason:'Original material is safe to share'},a);
  await fn({req,p,c,a,published,draft,reopen(){store.close();store=openLocalStore(path);}});
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
}
test('saving and unsaving approved lessons is private, idempotent and restart-safe',()=>runWithData(async({req,p,c,published,reopen})=>{
 assert.equal((await req('my/bookmarks')).status,401);
 assert.equal((await req('lessons/'+published+'/bookmark','POST',{})).status,401);
 assert.equal((await req('lessons/'+published+'/bookmark','POST',{},p)).status,201);
 assert.equal((await req('lessons/'+published+'/bookmark','POST',{},p)).status,200);
 let mine=await req('my/bookmarks','GET',undefined,p);assert.equal(mine.status,200);assert.equal(mine.data.lessons.length,1);assert.equal(mine.data.lessons[0].id,published);
 assert.equal(Object.hasOwn(mine.data.lessons[0],'lessonText'),false);
 assert.equal((await req('my/bookmarks','GET',undefined,c)).data.lessons.length,0);
 reopen();mine=await req('my/bookmarks','GET',undefined,p);assert.equal(mine.data.lessons.length,1);
 assert.equal((await req('lessons/'+published+'/unbookmark','POST',{},p)).status,201);
 assert.equal((await req('lessons/'+published+'/unbookmark','POST',{},p)).status,200);
 assert.equal((await req('my/bookmarks','GET',undefined,p)).data.lessons.length,0);
}));
test('bookmarks cannot reveal drafts, approve content or bypass school verification',()=>runWithData(async({req,p,draft})=>{
 assert.equal((await req('lessons/'+draft+'/bookmark','POST',{},p)).status,404);
 assert.equal((await req('lessons/not-real/bookmark','POST',{},p)).status,404);
 assert.equal((await req('lessons/'+draft+'/unbookmark','POST',{unknown:true},p)).status,400);
 assert.equal((await req('my/bookmarks','GET',undefined,p)).data.lessons.length,0);
}));
