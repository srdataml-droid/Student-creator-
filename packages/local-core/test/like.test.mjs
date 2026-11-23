import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const lessonText='This independently written study example shows each step of a proof, starting with the definition and demonstrating why every transformation is valid. It teaches the method and is not an assessment prepared for another student to submit as their own work.';

async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'creator-likes-')),file=join(dir,'data.sqlite');
 let store=openLocalStore(file);
 const req=async(route,method='GET',body,token)=>{
  const request=new Request('http://localhost:3000/api/local/'+route,{method,
   headers:{...(token?{cookie:'campus_local_session='+token}:{}),
     ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},
   ...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const res=await createLocalHandler(store)(request,route.split('/'));
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 };
 store.bootstrapAdmin('admin@likes.test','Strong Admin Password 2026');
 const admin=(await req('auth/login','POST',{email:'admin@likes.test',password:'Strong Admin Password 2026'})).cookie;
 const school=(await req('admin/institutions','POST',{name:'Example Likes University'},admin)).data.institution.id;
 const otherSchool=(await req('admin/institutions','POST',{name:'Other Example University'},admin)).data.institution.id;
 const course=(await req('admin/courses','POST',{institutionId:school,code:'PHY 202',title:'Physics Research'},admin)).data.course.id;
 async function student(email,institutionId,verify=true){
  const id=(await req('auth/register','POST',{email,password:'Strong Student Password 2026',institutionId})).data.user.id;
  if(verify)await req('admin/verify','POST',{userId:id},admin);
  const token=(await req('auth/login','POST',{email,password:'Strong Student Password 2026'})).cookie;
  return {id,token};
 }
 const creator=await student('creator@likes.test',school);
 const viewer=await student('viewer@likes.test',otherSchool);
 const unverified=await student('unverified@likes.test',school,false);
 const draft=(await req('lessons/drafts','POST',{courseId:course,title:'Original physics worked example',
  description:'Independent notes',previewText:'An original derivation',lessonText,rightsAttested:true,creationKey:'liked-lesson-draft-0001'},creator.token)).data.lesson.id;
 const privateDraft=(await req('lessons/drafts','POST',{courseId:course,title:'Private notes',
  description:'Private study',previewText:'Do not share',lessonText,rightsAttested:true,creationKey:'liked-lesson-draft-0002'},creator.token)).data.lesson.id;
 await req('lessons/'+draft+'/submit','POST',{},creator.token);
 await req('lessons/'+draft+'/review','POST',{decision:'approve',reason:'Original work suitable for sharing'},admin);
 return {req,crossOrigin:async(request,path)=>createLocalHandler(store)(request,path.split('/')),creator,viewer,unverified,draft,privateDraft,
  reopen(){store.close();store=openLocalStore(file);},
  close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('likes require verified students and publicly approved content, including across campuses',async()=>{
 const x=await setup();try{
  assert.equal((await x.req('my/likes')).status,401);
  assert.equal((await x.req('lessons/'+x.draft+'/like','POST',{})).status,401);
  assert.equal((await x.req('my/likes','GET',undefined,x.unverified.token)).status,403);
  assert.equal((await x.req('lessons/'+x.draft+'/like','POST',{},x.unverified.token)).status,403);
  assert.equal((await x.req('lessons/'+x.privateDraft+'/like','POST',{},x.viewer.token)).status,404);
  assert.equal((await x.req('lessons/unknown/like','POST',{},x.viewer.token)).status,404);
  assert.equal((await x.req('lessons/'+x.draft+'/like','POST',{unexpected:true},x.viewer.token)).status,400);
  assert.equal((await x.req('lessons/'+x.draft+'/like','POST',{},x.viewer.token)).status,201);
  assert.equal((await x.req('lessons/'+x.draft+'/like','POST',{},x.viewer.token)).status,200);
  assert.deepEqual((await x.req('my/likes','GET',undefined,x.viewer.token)).data.likes,[x.draft]);
  assert.deepEqual((await x.req('my/likes','GET',undefined,x.creator.token)).data.likes,[]);
  const publicResult=await x.req('lessons/'+x.draft,'GET',undefined,x.viewer.token);
  assert.equal(publicResult.status,200);
  assert.equal(publicResult.data.lesson.likeCount,1);
  x.reopen();
  assert.deepEqual((await x.req('my/likes','GET',undefined,x.viewer.token)).data.likes,[x.draft]);
  assert.equal((await x.req('lessons/'+x.draft+'/unlike','POST',{},x.creator.token)).data.like.replayed,true);
  assert.equal((await x.req('lessons/'+x.draft+'/unlike','POST',{},x.viewer.token)).status,201);
  assert.equal((await x.req('lessons/'+x.draft+'/unlike','POST',{},x.viewer.token)).status,200);
  assert.equal((await x.req('lessons/'+x.draft,'GET',undefined,x.viewer.token)).data.lesson.likeCount,0);
 }finally{x.close();}
});

test('session-scoped like state survives retry and cannot be changed cross-origin',async()=>{
 const x=await setup();try{
  const path='lessons/'+x.draft+'/like';
  assert.equal((await x.req(path,'POST',{},x.creator.token)).status,201);
  assert.equal((await x.req(path,'POST',{},x.viewer.token)).status,201);
  assert.equal((await x.req('lessons/'+x.draft,'GET',undefined,x.viewer.token)).data.lesson.likeCount,2);
  const hostile=new Request('http://localhost:3000/api/local/'+path,{method:'POST',
   headers:{cookie:'campus_local_session='+x.viewer.token,origin:'https://other-campus.test','content-type':'application/json'},body:'{}'});
  const rejected=await createLocalHandlerFrom(x,hostile,path);
  assert.equal(rejected.status,403);
  assert.equal((await x.req('lessons/'+x.draft,'GET',undefined,x.viewer.token)).data.lesson.likeCount,2);
 }finally{x.close();}
});

// Reuse the same public handler path for a malicious Origin probe without privileged store access.
// setup().req intentionally generates trusted same-origin requests.
async function createLocalHandlerFrom(x,request,path){
 // The handler is invoked through a fresh adapter on the same persistent SQLite database;
 // the fixture does not expose the store outside its own closure.
 return x.crossOrigin(request,path);
}
