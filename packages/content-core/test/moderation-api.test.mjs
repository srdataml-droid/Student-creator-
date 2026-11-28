import test from 'node:test';
import assert from 'node:assert/strict';
import {createModerationHandler,createSupabaseModerationDependencies} from '../src/moderation-api.mjs';
import {createCurrentSupabaseAuth} from '../../hosted-core/src/supabase-current-auth.mjs';
import {buildModerationRoute} from '../src/route-factory.mjs';
const staffId='77777777-7777-4777-8777-777777777777';
const creatorId='11111111-1111-4111-8111-111111111111';
const lessonId='55555555-5555-4555-8555-555555555555';
const url='https://school.example/api/lessons/'+lessonId+'/moderate';
function req(decision='approve',reason='Original course explanation',extra={}) {return new Request(url,{method:'POST',headers:{authorization:'Bearer staff-jwt','content-type':'application/json',...extra},body:JSON.stringify({decision,reason})});}
function deps(overrides={}) {
 const calls={write:0,audit:[]};
 let item={id:lessonId,creatorId,status:'in_review',reviewerId:null,reviewReason:null};
 const store={
  async getStaff(){return {active:true,role:'moderator'};},
  async getContent(){return {...item};},
  async changeStatusOnce({reviewerId,decision,reason}) {calls.write++;if(item.status!=='in_review')return false;item={...item,status:decision,reviewerId,reviewReason:reason};return true;},
  ...overrides.store
 };
 const auth={async getUser(){return {id:staffId};},...overrides.auth};
 const handler=createModerationHandler({auth,store,audit:e=>calls.audit.push(e)});
 return {handler,calls,get item(){return item;}};
}
const body=async response=>({status:response.status,...await response.json()});
test('moderator approves submitted lesson, logs event, and safely replays identical action',async()=>{
 const {handler,calls}=deps();let first=await body(await handler(req(),{lessonId}));let again=await body(await handler(req(),{lessonId}));
 assert.equal(first.status,200);assert.equal(first.lesson.status,'published');assert.equal(first.replayed,false);
 assert.equal(again.status,200);assert.equal(again.replayed,true);assert.equal(calls.write,1);assert.equal(calls.audit[0].event,'lesson.moderated');
});
test('moderator can reject with documented reason',async()=>{
 const {handler}=deps();const result=await body(await handler(req('reject','Unauthorized copied material'),{lessonId}));assert.equal(result.status,200);assert.equal(result.lesson.status,'rejected');
});
test('unauthed actor and unprivileged student never write',async()=>{
 const d=deps({store:{async getStaff(){return {active:true,role:'student'};}}});
 assert.equal((await d.handler(req(),{lessonId})).status,403);assert.equal(d.calls.write,0);
 const bad=new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'approve',reason:'Verified original material'})});
 assert.equal((await d.handler(bad,{lessonId})).status,401);
});
test('inactive staff and missing staff records cannot moderate',async()=>{
 for(const row of [null,{active:false,role:'moderator'},{active:true,role:'student'}]){
  const d=deps({store:{async getStaff(){return row;}}});assert.equal((await d.handler(req(),{lessonId})).status,403);assert.equal(d.calls.write,0);
 }
});
test('creator cannot self-approve even if mistakenly assigned moderator privileges',async()=>{
 const d=deps({auth:{async getUser(){return {id:creatorId};}}});const v=await body(await d.handler(req(),{lessonId}));assert.equal(v.status,403);assert.equal(v.error,'CONFLICT_OF_INTEREST');assert.equal(d.calls.write,0);
});
test('wrong lesson state, conflicting repeated decisions, and concurrent writes return conflict',async()=>{
 const d=deps();assert.equal((await d.handler(req(),{lessonId})).status,200);
 assert.equal((await d.handler(req('reject','Another objection'),{lessonId})).status,409);
 const c=deps({store:{async changeStatusOnce(){return false;}}});const v=await body(await c.handler(req(),{lessonId}));assert.equal(v.status,409);assert.equal(v.error,'CONCURRENT_DECISION');
});
test('invalid lesson id, decision, reason, JSON and large body fail without DB mutation',async()=>{
 const d=deps();assert.equal((await d.handler(req(),{lessonId:'not-uuid'})).status,400);
 assert.equal((await d.handler(req('delete','Not permitted'),{lessonId})).status,422);
 assert.equal((await d.handler(req('approve','x'),{lessonId})).status,422);
 const bad=new Request(url,{method:'POST',headers:{authorization:'Bearer staff-jwt','content-type':'application/json'},body:'{'});
 assert.equal((await d.handler(bad,{lessonId})).status,400);
 assert.equal((await d.handler(req('approve','x'.repeat(2500)),{lessonId})).status,413);
 assert.equal(d.calls.write,0);
});
test('missing lesson and provider timeout return safe errors without leaking provider internals',async()=>{
 const missing=deps({store:{async getContent(){return null;}}});assert.equal((await missing.handler(req(),{lessonId})).status,404);
 const broken=deps({store:{async getStaff(){throw Error('SECRET_DB_PASSWORD');}}});const v=await body(await broken.handler(req(),{lessonId}));assert.equal(v.status,503);assert.equal(v.error,'SERVICE_UNAVAILABLE');assert.equal(JSON.stringify(v).includes('SECRET_DB_PASSWORD'),false);
});
test('privileged REST moderation adapter validates external user and CAS preconditions',async()=>{
 const seen=[];
 const fetcher=async(dest,options)=>{
  seen.push({url:String(dest),options});
  if(String(dest).includes('/auth/v1/user'))return Response.json({id:staffId,email:'synthetic@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'});
  if(String(dest).includes('/student_creators_session_active'))return Response.json(true);
  if(String(dest).includes('platform_staff'))return Response.json([{user_id:staffId,active:true,role:'moderator'}]);
  if(String(dest).includes('content_items')&&options.method==='GET')return Response.json([{id:lessonId,creator_id:creatorId,status:'in_review'}]);
  if(options.method==='PATCH')return Response.json([{id:lessonId,status:'published'}]);
  throw new Error('Unexpected provider URL');
 };
 const {auth,store}=createSupabaseModerationDependencies({url:'https://test.supabase.co',publicKey:'public-key',serverKey:'server-key',fetcher,authFactory:createCurrentSupabaseAuth});
 assert.deepEqual(await auth.getUser('e30.'+Buffer.from(JSON.stringify({sub:staffId,session_id:lessonId,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature'),{id:staffId});
 assert.equal((await store.getStaff(staffId)).active,true);
 assert.equal((await store.getContent(lessonId)).status,'in_review');
 assert.equal(await store.changeStatusOnce({contentId:lessonId,reviewerId:staffId,decision:'published',reason:'Original work'}),true);
 const p=new URL(seen.at(-1).url);assert.equal(p.searchParams.get('status'),'eq.in_review');assert.equal(p.searchParams.get('reviewer_id'),'is.null');
 assert.equal(p.searchParams.get('creator_id'),`neq.${staffId}`);
 assert.equal(seen[0].options.headers.apikey,'public-key');
 assert.equal(seen.at(-1).options.headers.apikey,'server-key');
 assert.equal(JSON.parse(seen.at(-1).options.body).status,'published');
});
test('moderation route fails closed when no Supabase environment is configured',async()=>{
 let calls=0;const r=buildModerationRoute({getEnv:()=>({}),fetcher:async()=>{calls++;}});
 const v=await body(await r(req(),{lessonId}));assert.equal(v.status,503);assert.equal(v.error,'SERVICE_NOT_CONFIGURED');assert.equal(calls,0);
});
test('moderation route refuses non-HTTPS provider configuration',async()=>{
 assert.throws(()=>createSupabaseModerationDependencies({url:'http://evil.example',publicKey:'a',serverKey:'b',authFactory:createCurrentSupabaseAuth}),/HTTPS/);
});
