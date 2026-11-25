import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {buildHostedPaystackWebhook} from '../src/hosted-paystack-webhook.mjs';
const projectRef='a'.repeat(20),id='whk_fixture',secret='whsec_fixture_secret';
const env=()=>({STUDENT_CREATORS_WEEK05_WEBHOOK_ENABLED:'1',STUDENT_CREATORS_STAGING_APPROVED:'true',APP_DATA_MODE:'hosted',STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_PROJECT_REF:projectRef,SUPABASE_URL:'https://'+projectRef+'.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_123456',SUPABASE_SECRET_KEY:'sb_secret_fixture_123456',PAYSTACK_TEST_SECRET_KEY:'sk_test_fixture123',PAYSTACK_WEBHOOK_KEY_ID:id,PAYSTACK_WEBHOOK_SIGNING_SECRET:secret});
const event=()=>({event:'charge.success',data:{domain:'test',id:'tx1',reference:'sc_'+'a'.repeat(32),amount:1}});
function req(data=event(),{invalid=false,missing=false,type='application/json',length}={}){
 const raw=Buffer.from(JSON.stringify(data)),t=Math.floor(Date.now()/1000),sig=createHmac('sha512',secret).update(Buffer.concat([Buffer.from(t+'.'),raw])).digest('hex');
 return new Request('https://staging.example.invalid/api/payments/webhook',{method:'POST',headers:{'content-type':type,...(!missing?{'paystack-signature':invalid?'bad':'t='+t+',v1='+id+':'+sig}:{}),...(length?{'content-length':String(length)}:{})},body:raw});
}
test('default-off and live credentials rejected before network',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('unexpected');};
 assert.equal((await buildHostedPaystackWebhook({env:{},fetchImpl})(req())).status,503);
 assert.equal((await buildHostedPaystackWebhook({env:{...env(),PAYSTACK_TEST_SECRET_KEY:'sk_live_fixture123'},fetchImpl})(req())).status,503);
 assert.equal(calls,0);
});
test('bad signature and oversized raw body denied before database',async()=>{
 let calls=0;const post=buildHostedPaystackWebhook({env:env(),fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 for(const options of [{invalid:true},{missing:true}])assert.equal((await post(req(event(),options))).status,401);
 assert.equal((await post(req(event(),{length:1048577}))).status,413);
 assert.equal((await post(req(event(),{type:'text/plain'}))).status,415);
 assert.equal(calls,0);
});
test('signed event acknowledged only after durable enqueue, never Paystack verify in webhook',async()=>{
 const calls=[];const post=buildHostedPaystackWebhook({env:env(),fetchImpl:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return new Response(JSON.stringify({received:true,replayed:false}));}});
 assert.equal((await post(req())).status,200);
 assert.equal(calls.length,1);assert.match(calls[0].url,/week05_enqueue_test_charge$/);assert.deepEqual(Object.keys(calls[0].body).sort(),['p_digest','p_ref','p_tx']);
});
test('failed database persistence is retryable and not acknowledged',async()=>{
 const post=buildHostedPaystackWebhook({env:env(),fetchImpl:async()=>new Response('unavailable',{status:503})});
 assert.equal((await post(req())).status,503);
 const malformed=buildHostedPaystackWebhook({env:env(),fetchImpl:async()=>new Response(JSON.stringify({received:false}))});
 assert.equal((await malformed(req())).status,503);
});
test('live-domain event rejected and unsupported events ignored without provider or DB calls',async()=>{
 let calls=0;const post=buildHostedPaystackWebhook({env:env(),fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 const live=event();live.data.domain='live';assert.equal((await post(req(live))).status,400);
 const ignored=event();ignored.event='transfer.success';assert.equal((await post(req(ignored))).status,200);assert.equal(calls,0);
});
