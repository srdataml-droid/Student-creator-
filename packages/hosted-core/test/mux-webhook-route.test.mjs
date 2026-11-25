import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {createMuxWebhookHandler,buildMuxWebhookRoute} from '../src/mux-webhook-route.mjs';
const secret='synthetic_mux_signing_secret_only';
const time=1800000000;
const raw=JSON.stringify({id:'event_test_1',type:'video.upload.asset_created',data:{id:'upload_test_1',url:'https://private.example/capability',asset_id:'asset_test_1'}});
const sign=(s=raw,t=time)=>'t='+t+',v1='+createHmac('sha256',secret).update(t+'.'+s).digest('hex');
function request(body=raw,signature=sign(),headers={}){
 return new Request('https://example.invalid/api/webhooks/mux',{method:'POST',headers:{'content-type':'application/json','mux-signature':signature,...headers},body});
}
test('valid raw signature sends a minimal durable delivery, not private payload',async()=>{
 let captured;const h=createMuxWebhookHandler({secret,now:()=>time,record:async x=>{captured=x;return 'accepted';}});
 const r=await h(request());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(captured,{eventId:'event_test_1',kind:'video.upload.asset_created',resourceId:'upload_test_1',digest:createHash('sha256').update(raw).digest('hex')});
 assert.deepEqual(await r.json(),{received:true});
});
test('invalid signatures, stale signature, oversized stream and non-JSON never write',async()=>{
 let calls=0;const h=createMuxWebhookHandler({secret,now:()=>time,record:async()=>{calls++;}});
 for(const [r,status] of [[request(raw+' ',sign()),400],[request(raw,sign(raw,time-301)),400],
 [request('x'.repeat(262145)),413],[request(raw,sign(),{'content-type':'text/plain'}),415],
 [request(raw,sign(),{'content-length':'300000'}),413]])assert.equal((await h(r)).status,status);
 assert.equal(calls,0);
});
test('duplicates acknowledged, collisions rejected, transient DB errors retryable',async()=>{
 for(const [result,status] of [['duplicate',200],['collision',409],['unknown',503]]){
  const h=createMuxWebhookHandler({secret,now:()=>time,record:async()=>result});assert.equal((await h(request())).status,status);
 }
 const h=createMuxWebhookHandler({secret,now:()=>time,record:async()=>{throw Error('secret provider data');}});
 const r=await h(request());assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'MUX_INBOX_UNAVAILABLE'});
});
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_MUX_WEBHOOK_ENABLED:'true',
 supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',supabase_publishable_key:'sb_publishable_fixture_public',supabase_secret_key:'sb_secret_fixture_server',
 MUX_WEBHOOK_SIGNING_SECRET:secret};
test('route requires explicit dedicated staging gates and independently named signing secret',async()=>{
 let calls=0;for(const e of [{},{...env,STUDENT_CREATORS_MUX_WEBHOOK_ENABLED:'false'},{...env,supabase_url:'https://other.supabase.co'},
 {...env,MUX_WEBHOOK_SIGNING_SECRET:undefined},{...env,STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'}]){
  const h=buildMuxWebhookRoute({getEnv:()=>e,fetcher:async()=>{calls++;}});
  assert.equal((await h(request())).status,503);
 }assert.equal(calls,0);
});
test('real REST boundary uses only server credentials and exact RPC with verified body',async()=>{
 const now=Math.floor(Date.now()/1000);let seen;
 const h=buildMuxWebhookRoute({getEnv:()=>env,fetcher:async(url,opts)=>{seen={url:String(url),opts};return Response.json('accepted');}});
 assert.equal((await h(request(raw,sign(raw,now)))).status,200);
 assert.equal(seen.url,env.supabase_url+'/rest/v1/rpc/record_verified_mux_delivery');
 assert.equal(seen.opts.headers.apikey,env.supabase_secret_key);assert.equal(seen.opts.headers.authorization,undefined);
 assert.equal(seen.opts.redirect,'error');assert.ok(seen.opts.signal);
 assert.deepEqual(JSON.parse(seen.opts.body),{_event_id:'event_test_1',_digest:createHash('sha256').update(raw).digest('hex'),_event_type:'video.upload.asset_created',_resource_id:'upload_test_1'});
});
