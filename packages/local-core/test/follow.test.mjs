import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const explanation='This is my own original written explanation of a derivative. Starting from the definition of the difference quotient, I expand the expression, cancel the matching terms, and calculate the limiting rate of change. It demonstrates the process, rather than offering someone else an assignment to submit.';
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'student-creator-follow-'));const path=join(dir,'data.sqlite');
 let store=openLocalStore(path);store.bootstrapAdmin('admin@local.test','Strong Administrator Password 2026');
 const send=async(route,method='GET',body,token)=>{
 const req=new Request('http://localhost:3000/api/local/'+route,{method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),...(method==='POST'?{origin:'http://localhost:3000'}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const res=await createLocalHandler(store)(req,route.split('/'));
 return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 };
 const admin=(await send('auth/login','POST',{email:'admin@local.test',password:'Strong Administrator Password 2026'})).cookie;
 const school=(await send('admin/institutions','POST',{name:'Example Main Campus'},admin)).data.institution.id;
 const another=(await send('admin/institutions','POST',{name:'Example Other Campus'},admin)).data.institution.id;
 const course=(await send('admin/courses','POST',{institutionId:school,code:'STU 101',title:'Creator Studies'},admin)).data.course.id;
 const create=async(email,institutionId)=>{const uid=(await send('auth/register','POST',{email,password:'Student Strong Password 2026',institutionId})).data.user.id;const token=(await send('auth/login','POST',{email,password:'Student Strong Password 2026'})).cookie;return {id:uid,token};};
 const creator=await create('creator@example.test',school);
 const viewer=await create('viewer@example.test',another);
 const hidden=await create('hidden@example.test',school);
 const draft=(await send('lessons/drafts','POST',{courseId:course,title:'My original course example',description:'Own work for learning',previewText:'Concepts and demonstration',lessonText:explanation,rightsAttested:true,creationKey:'creator-follow-test-0001'},creator.token)).data;
 return {dir,path,send,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});},reopen:()=>{store.close();store=openLocalStore(path);},admin,creator,viewer,hidden,course,draft};
}
test('follow requires a verified account, a public creator and a different user',async()=>{
 const x=await setup();try{
  assert.equal((await x.send('following')).status,401);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','POST',{},x.viewer.token)).status,403);
  assert.equal((await x.send('creators/'+x.hidden.id+'/follow','POST',{},x.viewer.token)).status,403);
  assert.equal((await x.send('admin/verify','POST',{userId:x.creator.id},x.admin)).status,200);
  assert.equal((await x.send('admin/verify','POST',{userId:x.viewer.id},x.admin)).status,200);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','POST',{},x.creator.token)).status,422);
  assert.equal((await x.send('creators/'+x.hidden.id+'/follow','POST',{},x.viewer.token)).status,404);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','POST',{},x.viewer.token)).status,404);
 }finally{x.close();}
});
test('verified learner can follow a published creator across campuses, replay, unfollow and persist',async()=>{
 const x=await setup();try{
  await x.send('admin/verify','POST',{userId:x.creator.id},x.admin);
  await x.send('admin/verify','POST',{userId:x.viewer.id},x.admin);
  const id=x.draft.lesson.id;
  await x.send('lessons/'+id+'/submit','POST',{},x.creator.token);
  await x.send('lessons/'+id+'/review','POST',{decision:'approve',reason:'Original material is suitable'},x.admin);
  assert.deepEqual((await x.send('following','GET',undefined,x.viewer.token)).data.creators,[]);
  const ok=await x.send('creators/'+x.creator.id+'/follow','POST',{},x.viewer.token);
  assert.equal(ok.status,200);assert.equal(ok.data.follow.following,true);assert.equal(ok.data.follow.replayed,false);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','POST',{},x.viewer.token)).data.follow.replayed,true);
  assert.deepEqual((await x.send('following','GET',undefined,x.viewer.token)).data.creators,[x.creator.id]);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','GET',undefined,x.viewer.token)).data.following,true);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','POST',{extra:1},x.viewer.token)).status,400);
  x.reopen();
  assert.deepEqual((await x.send('following','GET',undefined,x.viewer.token)).data.creators,[x.creator.id]);
  const removed=await x.send('creators/'+x.creator.id+'/unfollow','POST',{},x.viewer.token);
  assert.equal(removed.status,200);assert.equal(removed.data.follow.following,false);
  assert.equal((await x.send('creators/'+x.creator.id+'/unfollow','POST',{},x.viewer.token)).data.follow.replayed,true);
  assert.equal((await x.send('creators/'+x.creator.id+'/follow','GET',undefined,x.viewer.token)).data.following,false);
 }finally{x.close();}
});
