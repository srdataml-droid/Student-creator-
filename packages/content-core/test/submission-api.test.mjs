import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewSubmissionHandler,createSupabaseSubmissionDependencies} from '../src/submission-api.mjs';
import {createCurrentSupabaseAuth} from '../../hosted-core/src/supabase-current-auth.mjs';
import {buildReviewSubmissionRoute} from '../src/route-factory.mjs';
const user='11111111-1111-4111-8111-111111111111', school='22222222-2222-4222-8222-222222222222', lesson='55555555-5555-4555-8555-555555555555';
const makeRequest=(headers={})=>new Request(`https://school.example/api/lessons/${lesson}/submit`,{method:'POST',headers:{authorization:'Bearer user-token',...headers}});
function setup(overrides={}){
 const calls={updates:0,audits:[]};
 let item={id:lesson,creatorId:user,institutionId:school,status:'draft'};
 let assets=[{contentId:lesson,processingStatus:'ready',scanVerdict:'clean',privateObjectKey:'private/lesson.pdf'}];
 const store={
  async getProfile(){return{institutionId:school,verifiedAt:'2026-11-19',suspended:false};},
  async getContent(){return {...item};},
  async getAssets(){return assets;},
  async submitIfReady({expectedStatus}){calls.updates++;if(item.status!==expectedStatus)return false;item={...item,status:'in_review'};return true;},
  ...overrides.store
 };
 const auth={async getUser(){return{id:user};},...overrides.auth};
 return {handler:createReviewSubmissionHandler({auth,store,audit:x=>calls.audits.push(x)}),calls,setAssets:x=>assets=x,get item(){return item}};
}
test('verified creator submits ready private lesson and repeated request is a safe replay',async()=>{
 const d=setup();const x=await d.handler(makeRequest(),{lessonId:lesson});assert.equal(x.status,200);assert.deepEqual((await x.json()).lesson,{id:lesson,status:'in_review'});
 const repeated=await d.handler(makeRequest(),{lessonId:lesson});assert.equal(repeated.status,200);assert.equal((await repeated.json()).replayed,true);assert.equal(d.calls.updates,1);assert.equal(d.calls.audits[0].event,'lesson.review.submitted');
});
test('unverified, suspended and unrelated students cannot submit',async()=>{
 for(const profile of [{institutionId:school,verifiedAt:null,suspended:false},{institutionId:school,verifiedAt:'2026-11-19',suspended:true}]){
  const d=setup({store:{async getProfile(){return profile;}}});assert.equal((await d.handler(makeRequest(),{lessonId:lesson})).status,403);assert.equal(d.calls.updates,0);
 }
 const alien=setup({auth:{async getUser(){return{id:'99999999-9999-4999-8999-999999999999'};}}});assert.equal((await alien.handler(makeRequest(),{lessonId:lesson})).status,403);assert.equal(alien.calls.updates,0);
});
test('pending scan, malicious asset, asset not owned and missing files block submission',async()=>{
 for(const a of [[],[{contentId:lesson,processingStatus:'ready',scanVerdict:'malicious',privateObjectKey:'private/a.pdf'}],[{contentId:lesson,processingStatus:'scanning',scanVerdict:'pending',privateObjectKey:'private/a.pdf'}],[{contentId:lesson,processingStatus:'ready',scanVerdict:'clean',privateObjectKey:'public/a.pdf'}]]){
  const d=setup();d.setAssets(a);const r=await d.handler(makeRequest(),{lessonId:lesson});assert.equal(r.status,422);assert.equal(d.calls.updates,0);
 }
});
test('concurrent database rejection fails closed instead of inferring success',async()=>{
 const d=setup({store:{async submitIfReady(){return false;}}});const r=await d.handler(makeRequest(),{lessonId:lesson});assert.equal(r.status,409);assert.equal((await r.json()).error,'SUBMISSION_CONFLICT');
});
test('missing bearer, invalid IDs and unexpected body never mutate',async()=>{
 const d=setup();const missing=new Request(`https://school.example/api/lessons/${lesson}/submit`,{method:'POST'});
 assert.equal((await d.handler(missing,{lessonId:lesson})).status,401);
 assert.equal((await d.handler(makeRequest(),{lessonId:'not-uuid'})).status,400);
 const withBody=new Request(`https://school.example/api/lessons/${lesson}/submit`,{method:'POST',headers:{authorization:'Bearer user-token'},body:'{"status":"published"}'});
 assert.equal((await d.handler(withBody,{lessonId:lesson})).status,400);
 assert.equal(d.calls.updates,0);
});
test('external error returns safe 503 without exposing credentials',async()=>{
 const d=setup({store:{async getAssets(){throw new Error('PRIVATE_PASSWORD');}}});const r=await d.handler(makeRequest(),{lessonId:lesson});assert.equal(r.status,503);assert.equal(JSON.stringify(await r.json()).includes('PRIVATE_PASSWORD'),false);
});
test('staging RPC uses server-only key and sends required CAS parameters',async()=>{
 const requests=[];
 const fetcher=async(u,opts)=>{
  requests.push({url:String(u),opts});
  if(String(u).includes('/auth/v1/user'))return Response.json({id:user,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
  if(String(u).includes('/student_creators_session_active')||String(u).includes('/affiliation_eligible'))return Response.json(true);
  if(String(u).includes('student_profiles'))return Response.json([{institution_id:school,verified_at:'2026-11-19',suspended:false}]);
  if(String(u).includes('content_items'))return Response.json([{id:lesson,creator_id:user,institution_id:school,status:'draft'}]);
  if(String(u).includes('content_assets'))return Response.json([{content_id:lesson,private_object_key:'private/a.pdf',processing_status:'ready',scan_verdict:'clean'}]);
  if(String(u).includes('submit_content_for_review'))return Response.json(true);
  throw Error('Unexpected provider request');
 };
 const d=createSupabaseSubmissionDependencies({url:'https://test.supabase.co',publicKey:'public',serverKey:'service',fetcher,authFactory:createCurrentSupabaseAuth});
 assert.equal((await d.auth.getUser('e30.'+Buffer.from(JSON.stringify({sub:user,session_id:lesson,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature')).id,user);assert.equal((await d.store.getProfile(user)).institutionId,school);
 assert.equal((await d.store.getContent(lesson)).status,'draft');assert.equal((await d.store.getAssets(lesson)).length,1);
 assert.equal(await d.store.submitIfReady({lessonId:lesson,creatorId:user,expectedStatus:'draft'}),true);
 assert.equal(requests[0].opts.headers.apikey,'public');assert.equal(requests.at(-1).opts.headers.apikey,'service');
 assert.match(requests.at(-1).url,/rpc\/submit_content_for_review$/);
 assert.deepEqual(JSON.parse(requests.at(-1).opts.body),{_content_id:lesson,_creator_id:user,_expected_status:'draft'});
});
test('unconfigured submission route fails closed and makes zero provider calls',async()=>{
 let calls=0;const h=buildReviewSubmissionRoute({getEnv:()=>({}),fetcher:async()=>{calls++}});const r=await h(makeRequest(),{lessonId:lesson});assert.equal(r.status,503);assert.equal(calls,0);
});
