import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHostedHealthRoute} from '../src/hosted-health.mjs';
const token='synthetic_health_token_only_12345678901234567890';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_HEALTH_ENABLED:'true',
 STUDENT_CREATORS_HEALTH_TOKEN:token,supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',
 supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server'};
const req=(t=token)=>new Request('https://staging.example.invalid/api/internal/health',{headers:t?{authorization:'Bearer '+t}:{}});
function fixture({e=env,breakCheck}={}){
 const calls=[];
 const handler=buildHostedHealthRoute({getEnv:()=>e,fetcher:async(url,opts)=>{
  calls.push({url:String(url),opts});const path=new URL(url).pathname;
  if(path==='/auth/v1/settings')return Response.json({disable_signup:breakCheck!=='signup',private:'never show'});
  if(path==='/rest/v1/institutions')return Response.json([]);
  if(path.endsWith('/student_creators_session_active')){
   return opts.headers.apikey===env.supabase_publishable_key?Response.json(false,{status:breakCheck==='rpc'?200:403}):Response.json(false);
  }
  if(path.endsWith('private-identity'))return Response.json({id:'student-creators-private-identity',public:breakCheck==='bucket',file_size_limit:5242880,allowed_mime_types:['image/png','image/jpeg','application/pdf']});
  if(path.endsWith('private-media'))return Response.json({id:'student-creators-private-media',public:false,file_size_limit:104857600,allowed_mime_types:['video/mp4','video/webm','image/jpeg','image/png','text/vtt']});
  throw Error('unexpected');
 }});
 return {handler,calls};
}
test('health endpoint is invisible to unauthenticated requests and disabled config',async()=>{
 for(const [e,t] of [[env,''],[env,'wrong_token_that_is_long_enough_1234567890'],[{...env,STUDENT_CREATORS_HEALTH_ENABLED:'false'},token]]){
  const {handler,calls}=fixture({e});assert.equal((await handler(req(t))).status,404);assert.equal(calls.length,0);
 }
});
test('read-only probe reports foundation reachability without provider data or secrets',async()=>{
 const {handler,calls}=fixture();const r=await handler(req()),b=await r.json();
 assert.equal(r.status,200);assert.equal(b.status,'foundation_reachable');assert.equal(b.releaseApproved,false);
 assert.equal(Object.values(b.checks).every(Boolean),true);assert.equal(calls.length,6);
 assert.equal(r.headers.get('cache-control'),'private, no-store');
 for(const c of calls){assert.equal(c.opts.redirect,'error');assert.equal(c.opts.cache,'no-store');assert.ok(c.opts.signal);
 assert.equal(new URL(c.url).origin,env.supabase_url);}
 assert.equal(JSON.stringify(b).includes('never show'),false);assert.equal(JSON.stringify(b).includes(env.supabase_secret_key),false);
});
test('public signup, callable privileged RPC and public identity bucket all degrade readiness',async()=>{
 for(const breakCheck of ['signup','rpc','bucket']){
  const {handler}=fixture({breakCheck});const r=await handler(req());assert.equal(r.status,503);assert.equal((await r.json()).releaseApproved,false);
 }
});
test('wrong project or invalid key never makes a request even with health bearer',async()=>{
 const {handler,calls}=fixture({e:{...env,supabase_url:'https://other.supabase.co'}});
 assert.equal((await handler(req())).status,503);assert.equal(calls.length,0);
});
