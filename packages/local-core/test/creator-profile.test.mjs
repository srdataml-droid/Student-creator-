import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

const explanation='An original lesson about how to reason from evidence. First choose a small example, draw out each assumption, calculate a result, test it against a different case, and explain why the outcome follows. This is teaching material and not an assignment to submit for a grade.';
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'campus-creator-profile-')),file=join(dir,'campus.sqlite');
 let store=openLocalStore(file);
 store.bootstrapAdmin('admin@profiles.invalid','Strong Administrator Password 2026');
 const req=async(route,method='GET',body,token)=>{
   const request=new Request('http://localhost:3000/api/local/'+route,{
     method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),
       ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},
     ...(body===undefined?{}:{body:JSON.stringify(body)})
   });
   const response=await createLocalHandler(store)(request,route.split('/'));
   return {status:response.status,data:await response.json(),
     token:response.headers.get('set-cookie')?.match(/campus_local_session=([^;]+)/)?.[1]};
 };
 const admin=(await req('auth/login','POST',{email:'admin@profiles.invalid',password:'Strong Administrator Password 2026'})).token;
 const campus=(await req('admin/institutions','POST',{name:'A Synthetic Campus'},admin)).data.institution.id;
 const otherCampus=(await req('admin/institutions','POST',{name:'B Synthetic Campus'},admin)).data.institution.id;
 const course=(await req('admin/courses','POST',{institutionId:campus,code:'PRO 101',title:'Creator Practice'},admin)).data.course.id;
 async function create(email,institutionId,verified){
   const user=(await req('auth/register','POST',{email,password:'Strong Student Password 2026',institutionId})).data.user;
   if(verified)assert.equal((await req('admin/verify','POST',{userId:user.id},admin)).status,200);
   return {id:user.id,token:(await req('auth/login','POST',{email,password:'Strong Student Password 2026'})).token,email};
 }
 const alice=await create('alice@profiles.invalid',campus,true);
 const bob=await create('bob@profiles.invalid',otherCampus,true);
 const pending=await create('pending@profiles.invalid',campus,false);
 async function publish(){
  const draft=(await req('lessons/drafts','POST',{courseId:course,title:'Public creator profile lesson',
    description:'Original practical study work',previewText:'Learn by reasoning',
    lessonText:explanation,rightsAttested:true,creationKey:'profile-published-00001'},alice.token)).data.lesson.id;
  assert.equal((await req('lessons/'+draft+'/submit','POST',{},alice.token)).status,200);
  assert.equal((await req('lessons/'+draft+'/review','POST',{decision:'approve',reason:'Original teaching reviewed'},admin)).status,200);
  return draft;
 }
 return {req,admin,alice,bob,pending,publish,reopen(){store.close();store=openLocalStore(file);},
   close(){store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('own profile requires verified student; reserved names and client-selected roles fail closed',async()=>{
 const x=await setup();
 try{
  const profile={handle:'alice_teaches',displayName:'Alice Teaches',bio:'Original study tips'};
  assert.equal((await x.req('my/creator-profile')).status,401);
  assert.equal((await x.req('my/creator-profile','GET',undefined,x.pending.token)).status,403);
  assert.equal((await x.req('my/creator-profile','POST',profile,x.pending.token)).status,403);
  assert.equal((await x.req('my/creator-profile','POST',{...profile,handle:'official_admin'},x.alice.token)).status,422);
  assert.equal((await x.req('my/creator-profile','POST',{...profile,role:'admin'},x.alice.token)).status,422);
  assert.equal((await x.req('my/creator-profile','GET',undefined,x.alice.token)).data.profile,null);
  assert.equal((await x.req('my/creator-profile','POST',profile,x.alice.token)).status,201);
  assert.equal((await x.req('my/creator-profile','POST',profile,x.alice.token)).status,200);
  assert.equal((await x.req('my/creator-profile','POST',{...profile,displayName:'A fake university official'},x.alice.token)).status,422);
  assert.equal((await x.req('my/creator-profile','GET',undefined,x.alice.token)).data.profile.handle,'alice_teaches');
  assert.equal((await x.req('my/creator-profile','GET',undefined,x.bob.token)).data.profile,null);
  assert.equal((await x.req('my/creator-profile','POST',{...profile,handle:'ALICE_TEACHES'},x.bob.token)).status,409);
  assert.equal((await x.req('my/creator-profile','POST',{...profile,userId:x.bob.id},x.alice.token)).status,422);
 }finally{x.close();}
});
test('profile becomes public only after independent lesson approval, with no private account email',async()=>{
 const x=await setup();
 try{
  const profile={handle:'alice_research',displayName:'Alice Research',bio:'Study notes and examples'};
  assert.equal((await x.req('my/creator-profile','POST',profile,x.alice.token)).status,201);
  assert.equal((await x.req('creators/'+x.alice.id)).status,404);
  await x.publish();
  const publicResult=await x.req('creators/'+x.alice.id);
  assert.equal(publicResult.status,200);
  assert.equal(publicResult.data.creator.handle,'alice_research');
  assert.equal(publicResult.data.creator.displayName,'Alice Research');
  assert.equal(publicResult.data.creator.bio,'Study notes and examples');
  assert.equal('email' in publicResult.data.creator,false);
  assert.equal(JSON.stringify(publicResult.data).includes(x.alice.email),false);
  x.reopen();
  assert.equal((await x.req('creators/'+x.alice.id)).data.creator.handle,'alice_research');
  assert.equal((await x.req('my/creator-profile','GET',undefined,x.alice.token)).data.profile.bio,'Study notes and examples');
  assert.equal((await x.req('creators/'+x.bob.id)).status,404);
 }finally{x.close();}
});
test('profile changes are bounded by an audit-backed rolling edit limit without penalizing idempotent retries',async()=>{
 const x=await setup();
 try{
  const base={handle:'alice_learning',displayName:'Alice Learning'};
  for(let i=0;i<5;i++){
    assert.equal((await x.req('my/creator-profile','POST',{...base,bio:'Edit '+i},x.alice.token)).status,201);
  }
  assert.equal((await x.req('my/creator-profile','POST',{...base,bio:'Edit 4'},x.alice.token)).status,200);
  const denied=await x.req('my/creator-profile','POST',{...base,bio:'Edit 5'},x.alice.token);
  assert.equal(denied.status,429);
  assert.equal((await x.req('my/creator-profile','GET',undefined,x.alice.token)).data.profile.bio,'Edit 4');
 }finally{x.close();}
});
