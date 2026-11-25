import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedSocialHandler} from '../src/hosted-social-http.mjs';
const projectRef='abcdefghij1234567890',actor='80c0c4f0-847e-4779-a83c-2ff1993f1921',peer='11111111-1111-4111-8111-111111111111',token='e30.eyJzdWIiOiJ0ZXN0In0.SIGNATUREonly';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_SOCIAL_STAGING_ENABLED:'true',STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_PROJECT_REF:projectRef,SUPABASE_URL:'https://'+projectRef+'.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TESTONLY_EXAMPLE_123456789'};
function fixture({changes={},state={userId:actor,active:true,student:true,admin:false}}={}){
 const calls=[];
 const handle=createHostedSocialHandler({env:{...env,...changes},fetchImpl:async(url,opts)=>{
  calls.push([url,opts]);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:actor,email:'synthetic@example.invalid',email_confirmed_at:'2026-11-24',is_anonymous:false});
  if(url.endsWith('/rpc/social_session_state'))return Response.json(state);
  return Response.json({ok:true});
 }});
 const run=(operation,input={},headers={},method='POST')=>handle(new Request('https://staging.example.invalid/api/social/'+operation,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(input)}:{})}),operation);
 return {calls,run};
}
test('actual HTTP handler verifies Auth, checks current session, then calls fixed RPC with same bearer',async()=>{
 const x=fixture(),res=await x.run('send',{peerId:peer,text:'question'});
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
 assert.equal(x.calls.length,3);assert.ok(x.calls[0][0].endsWith('/auth/v1/user'));assert.ok(x.calls[1][0].endsWith('/rpc/social_session_state'));assert.ok(x.calls[2][0].endsWith('/rpc/social_message_action'));
 for(const [url,o] of x.calls){assert.equal(o.headers.Authorization,'Bearer '+token);assert.equal(o.redirect,'error');}
});
test('revoked, mismatched or ineligible session fails closed before mutations',async()=>{
 for(const [state,expected] of [[{userId:actor,active:false,student:false,admin:false},401],[{userId:actor,active:true,student:false,admin:false},403],[{userId:peer,active:true,student:true,admin:true},503]]){
  const x=fixture({state});assert.equal((await x.run('send',{peerId:peer,text:'hello'})).status,expected);assert.equal(x.calls.length,2);
 }
});
test('separate admin role is required for report queues and course role assignment',async()=>{
 const ordinary=fixture();assert.equal((await ordinary.run('reportQueue',{kind:'message'})).status,403);assert.equal(ordinary.calls.length,2);
 const staff=fixture({state:{userId:actor,active:true,student:false,admin:true}});
 assert.equal((await staff.run('reportQueue',{kind:'message'})).status,200);
 assert.ok(staff.calls[2][0].endsWith('/rpc/social_report_queue'));
 assert.equal((await staff.run('setCommunityModerator',{courseId:peer,userId:actor,enabled:true,reason:'Approved role'})).status,200);
 assert.equal((await staff.run('send',{peerId:peer,text:'not enrolled'})).status,403);
});
test('disabled staging, origin, missing bearer and oversized bodies do not contact provider',async()=>{
 for(const changes of [{STUDENT_CREATORS_SOCIAL_STAGING_ENABLED:'false'},{STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'},{STUDENT_CREATORS_PROJECT_REF:'otherproject12345678'}]){
  const x=fixture({changes});assert.equal((await x.run('inbox')).status,503);assert.equal(x.calls.length,0);
 }
 const x=fixture();assert.equal((await x.run('inbox',{}, {origin:'https://untrusted.example'})).status,403);
 assert.equal((await x.run('inbox',{}, {authorization:''})).status,401);
 assert.equal((await x.run('send',{text:'x'.repeat(33000)})).status,413);
 assert.equal((await x.run('inbox',{}, {},'GET')).status,405);assert.equal(x.calls.length,0);
});
