import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const explanation='An original calculus teaching lesson about derivatives with a worked example that is not a completed assessment.';
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'campus-search-'));
 const store=openLocalStore(join(dir,'campus.sqlite'));
 store.bootstrapAdmin('admin@search.test','Strong Search Admin Password 2026');
 async function req(path,method='GET',body,token){
  const r=new Request('http://localhost:3000/api/local/'+path,{
   method,headers:{...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),...(token?{cookie:'campus_local_session='+token}:{})},
   ...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const response=await createLocalHandler(store)(r,new URL(r.url).pathname.replace('/api/local/','').split('/'));
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 }
 async function seed(){
  const admin=(await req('auth/login','POST',{email:'admin@search.test',password:'Strong Search Admin Password 2026'})).cookie;
  const school=(await req('admin/institutions','POST',{name:'Search University One'},admin)).body.institution.id;
  const other=(await req('admin/institutions','POST',{name:'Search University Two'},admin)).body.institution.id;
  const course=(await req('admin/courses','POST',{institutionId:school,code:'MTH 101',title:'Calculus Fundamentals'},admin)).body.course.id;
  const course2=(await req('admin/courses','POST',{institutionId:other,code:'ENG 201',title:'Engineering Mathematics'},admin)).body.course.id;
  const topic=(await req('admin/topics','POST',{courseId:course,name:'Differentiation'},admin)).body.topic.id;
  const topic2=(await req('admin/topics','POST',{courseId:course2,name:'CAD sketches'},admin)).body.topic.id;
  const creator=(await req('auth/register','POST',{email:'creator@search.test',password:'Strong Creator Password 2026',institutionId:school})).body.user.id;
  const creator2=(await req('auth/register','POST',{email:'creator2@search.test',password:'Strong Other Creator Password',institutionId:other})).body.user.id;
  await req('admin/verify','POST',{userId:creator},admin);await req('admin/verify','POST',{userId:creator2},admin);
  const login=async(email,password)=>(await req('auth/login','POST',{email,password})).cookie;
  const student=await login('creator@search.test','Strong Creator Password 2026');
  const student2=await login('creator2@search.test','Strong Other Creator Password');
  async function draft(token,courseId,topicId,title,key){
   const r=await req('lessons/drafts','POST',{courseId,topicId,title,description:'Original lesson',previewText:'Core study material',lessonText:explanation,rightsAttested:true,creationKey:key},token);
   assert.equal(r.status,201);return r.body.lesson.id;
  }
  const published=await draft(student,course,topic,'Derivative examples for calculus','search-draft-creation-01');
  await draft(student,course,topic,'Secret hidden draft','search-draft-creation-02');
  const published2=await draft(student2,course2,topic2,'Engineering 85% readiness','search-draft-creation-03');
  for(const [id,token] of [[published,student],[published2,student2]]){
   assert.equal((await req('lessons/'+id+'/submit','POST',{},token)).status,200);
   assert.equal((await req('lessons/'+id+'/review','POST',{decision:'approve',reason:'Original lesson approved by moderator'},admin)).status,200);
  }
  return {school,other,course,course2,topic,topic2,published,published2};
 }
 return {seed,req,close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('only published lesson metadata is searchable, with campus/course/topic validation',async()=>{
 const ctx=setup();try{
  const s=await ctx.seed(),p=await ctx.req('search?q=Derivative%20examples');
  assert.equal(p.status,200);assert.equal(p.body.results.length,1);
  assert.equal(p.body.results[0].id,s.published);
  assert.equal(p.body.results[0].institutionId,s.school);
  assert.equal(Object.hasOwn(p.body.results[0],'lessonText'),false);
  assert.equal((await ctx.req('search?q=Secret')).body.results.length,0);
  assert.equal((await ctx.req('search?q=Derivative%20examples&institutionId='+s.other)).body.results.length,0);
  assert.equal((await ctx.req('search?q=calculus&courseId='+s.course)).body.results.length,1);
  assert.equal((await ctx.req('search?q=Derivative%20examples&topicId='+s.topic2)).body.results.length,0);
  assert.equal((await ctx.req('search?q=calculus&institutionId='+s.other+'&courseId='+s.course)).status,422);
  assert.equal((await ctx.req('search?q=calculus&courseId='+s.course+'&topicId='+s.topic2)).status,422);
  assert.equal((await ctx.req('search?q=MTH%20101')).body.results.length,1);
  assert.equal((await ctx.req('search?q=University%20Two')).body.results.length,1);
 }finally{ctx.close();}
});
test('SQL metacharacters are literal and search limits/inputs fail closed',async()=>{
 const ctx=setup();try{
  const s=await ctx.seed();
  assert.equal((await ctx.req('search?q=85%25')).body.results.length,1);
  assert.equal((await ctx.req('search?q=85%5F')).body.results.length,0);
  assert.equal((await ctx.req('search?q=%27%20OR%201%3D1%20--')).body.results.length,0);
  for(const url of ['search','search?q=','search?q=a','search?q='+encodeURIComponent('x'.repeat(81)),'search?q=calculus&limit=51','search?q=calculus&limit=-1','search?q=calculus&courseId=bad-uuid']){
   assert.equal((await ctx.req(url)).status,422,url);
  }
  assert.equal((await ctx.req('search?q=calculus&limit=1')).body.results.length,1);
 }finally{ctx.close();}
});
