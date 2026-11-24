import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCurrentStudentBearer} from '../src/supabase-student-auth.mjs';

const projectRef='abcdefghij1234567890';
const token=['e30','eyJzdWIiOiJ0ZXN0In0','SIGNATUREonly'].join('.');
const userId='80c0c4f0-847e-4779-a83c-2ff1993f1921';
const user={id:userId,email:'verified@example.test',email_confirmed_at:'2026-11-24T00:00:00Z',is_anonymous:false};
const makeFetch=(body=user,status=200)=>async()=>({status,json:async()=>body});
const base={accessToken:token,projectRef,publishableKey:'sb_publishable_TESTONLY_EXAMPLE_123456789',
 fetchImpl:makeFetch(),isCurrentSession:async()=>true,authorizeStudent:async()=>true};
const matching=(code)=>({code});
test('requires remote verified identity plus current session and student eligibility',async()=>{
 const calls=[];
 const result=await verifyCurrentStudentBearer({...base,fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method,headers:options.headers,redirect:options.redirect,cache:options.cache,signal:options.signal});
  return {status:200,json:async()=>user};
 },isCurrentSession:async({userId:id,accessToken})=>{
  assert.equal(id,userId);assert.equal(accessToken,token);return true;
 },authorizeStudent:async({userId:id})=>{assert.equal(id,userId);return true;}});
 assert.deepEqual(result,{userId});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://'+projectRef+'.supabase.co/auth/v1/user');
 assert.equal(calls[0].headers.apikey,base.publishableKey);
 assert.equal(calls[0].headers.Authorization,'Bearer '+token);
 assert.equal(calls[0].method,'GET');
 assert.equal(calls[0].cache,'no-store');
 assert.equal(calls[0].redirect,'error');
 assert.ok(calls[0].signal);
 assert.equal(JSON.stringify(result).includes(user.email),false);
});
test('invalid bearer input is rejected before contacting provider',async()=>{
 let calls=0;
 for(const invalid of [undefined,'', 'a.b','bad-opaque','sb_secret_must_not_be_token','e30.e30.e30'+'x'.repeat(8192)]){
  await assert.rejects(verifyCurrentStudentBearer({...base,accessToken:invalid,fetchImpl:async()=>{calls++;}}),matching('AUTH_REQUIRED'));
 }
 assert.equal(calls,0);
});
test('provider 401 and 403 deny without running authorization callbacks',async()=>{
 for(const status of [401,403]){
  let called=false;
  await assert.rejects(verifyCurrentStudentBearer({...base,fetchImpl:makeFetch({},status),
    isCurrentSession:async()=>{called=true;return true;}}),matching('AUTH_REQUIRED'));
  assert.equal(called,false);
 }
});
test('provider outage, unexpected response and malformed JSON fail closed',async()=>{
 for(const fetchImpl of [async()=>{throw Error('network down');},async()=>({status:500}),
   async()=>({status:200,json:async()=>{throw Error('bad json');}})]){
  await assert.rejects(verifyCurrentStudentBearer({...base,fetchImpl}),matching('HOSTED_AUTH_UNAVAILABLE'));
 }
});
test('rejects unconfirmed, anonymous, malformed and identifierless users',async()=>{
 const invalid=[{...user,email_confirmed_at:null},{...user,is_anonymous:true},{...user,id:'not-uuid'},
   {...user,email:null},{...user,id:null},null];
 for(const body of invalid)
  await assert.rejects(verifyCurrentStudentBearer({...base,fetchImpl:makeFetch(body)}),
    matching('VERIFIED_STUDENT_REQUIRED'));
});
test('must positively check current session and student status, not stale JWT metadata',async()=>{
 await assert.rejects(verifyCurrentStudentBearer({...base,isCurrentSession:async()=>false}),
  matching('SESSION_NOT_ACTIVE'));
 await assert.rejects(verifyCurrentStudentBearer({...base,authorizeStudent:async()=>false}),
  matching('STUDENT_NOT_ELIGIBLE'));
 for(const authorizeStudent of [async()=>null,async()=>'true']){
  await assert.rejects(verifyCurrentStudentBearer({...base,authorizeStudent}),
   matching('STUDENT_NOT_ELIGIBLE'));
 }
});
test('missing policy callbacks or invalid project credentials never bypass authorization',async()=>{
 for(const changes of [{isCurrentSession:undefined},{authorizeStudent:undefined}]){
  await assert.rejects(verifyCurrentStudentBearer({...base,...changes}),
   matching('HOSTED_AUTH_POLICIES_UNAVAILABLE'));
 }
 for(const changes of [{projectRef:'something-else'},{projectRef:'api.supabase.co'},
   {publishableKey:'sb_secret_do_not_use'}, {fetchImpl:null}]){
  await assert.rejects(verifyCurrentStudentBearer({...base,...changes}),
   matching('HOSTED_AUTH_NOT_CONFIGURED'));
 }
});
test('callback infrastructure failure is a hard denial, not a permissive fallback',async()=>{
 for(const changes of [{isCurrentSession:async()=>{throw Error('db down');}},
   {authorizeStudent:async()=>{throw Error('db down');}}]){
  await assert.rejects(verifyCurrentStudentBearer({...base,...changes}),
   matching('HOSTED_AUTH_CHECK_UNAVAILABLE'));
 }
});
test('no student eligibility check after inactive session and no raw user metadata inference',async()=>{
 let called=false;
 const supplied={...user,user_metadata:{role:'admin',verified:true},app_metadata:{student:true}};
 await assert.rejects(verifyCurrentStudentBearer({...base,fetchImpl:makeFetch(supplied),
   isCurrentSession:async()=>false,authorizeStudent:async()=>{called=true;return true;}}),
   matching('SESSION_NOT_ACTIVE'));
 assert.equal(called,false);
});
