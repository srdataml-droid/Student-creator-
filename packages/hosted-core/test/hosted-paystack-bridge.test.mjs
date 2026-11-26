import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createHostedCheckoutHandler,createHostedPaystackWebhook,processHostedPaystackCharge,buildHostedPaystackRoute,readPaystackSigningSecrets,createHostedPaystackRuntime} from '../src/hosted-paystack-bridge.mjs';
const orderId='f1910000-0000-4000-8000-000000000001',lessonId='f1910000-0000-4000-8000-000000000002',id='f1910000-0000-4000-8000-000000000003',origin='https://preview.invalid',reference='sc_'+'a'.repeat(32),tx='test_tx';
const o={orderId,reference,buyerEmail:'fixture@example.invalid',amountKobo:20000,domain:'test',status:'claimed',create:true};
const req=(body)=>new Request(origin,{method:'POST',headers:{origin,authorization:'Bearer fixture','idempotency-key':'fixture_request_1234'},...(body?{body}:{})});
test('checkout initializes only once, price comes from persisted order',async()=>{let count=0,finished=[];const deps={auth:{getUser:async()=>({id})},origin,store:{reserve:async()=>count?{...o,create:false}:o,finish:async(...a)=>{finished.push(a);return true;}},gateway:{initialize:async order=>{count++;assert.equal(order.amountKobo,20000);return {reference,authorizationUrl:'https://checkout.paystack.com/fixture'};}}};const h=createHostedCheckoutHandler(deps);assert.equal((await h(req('{"amount":1}'),{lessonId})).status,400);assert.equal((await h(req(),{lessonId})).status,201);assert.equal((await h(req(),{lessonId})).status,202);assert.equal(count,1);assert.equal(finished.length,1);});
test('webhook requires exact raw v1 signature; no provider call in intake',async()=>{const secret='whsec_fixture_secret',kid='whk_fixture',raw=JSON.stringify({event:'charge.success',data:{domain:'test',reference,id:tx}}),ts=Math.floor(Date.now()/1000),sig=createHmac('sha512',secret).update(ts+'.'+raw).digest('hex');let records=0;const h=createHostedPaystackWebhook({signingSecrets:[{id:kid,secret}],store:{record:async(...a)=>{records++;assert.equal(a[0],reference);assert.equal(a[1],tx);return 'accepted';}}});assert.equal((await h(new Request(origin,{method:'POST',body:raw+' ',headers:{'paystack-signature':'t='+ts+',v1='+kid+':'+sig}}))).status,401);assert.equal((await h(new Request(origin,{method:'POST',body:raw,headers:{'paystack-signature':'t='+ts+',v1='+kid+':'+sig}}))).status,200);assert.equal(records,1);});
test('worker independently verifies provider response before atomic settlement; mismatches retry',async()=>{let settled=0,retry=0;const event={key:'charge:key',leaseId:id,reference,providerTx:tx};const store={claim:async()=>event,snapshot:async()=>o,settle:async()=>{settled++;return true;},retry:async()=>{retry++;return true;}};const charge={providerTransactionId:tx,domain:'test',currency:'NGN',amountKobo:20000,providerFeeKobo:0};assert.equal((await processHostedPaystackCharge({store,gateway:{verify:async()=>charge}})).state,'processed');assert.equal((await processHostedPaystackCharge({store,gateway:{verify:async()=>({...charge,providerTransactionId:'other'})}})).state,'retry');assert.equal(settled,1);assert.equal(retry,1);});
test('disabled configuration never contacts provider',async()=>{const h=buildHostedPaystackRoute({getEnv:()=>({}),fetcher:()=>{throw Error('unexpected');}});assert.equal((await h(req(),{lessonId})).status,503);});

test('rotation supports either active v1 signature and refuses malformed or incomplete slots',async()=>{
 const current={PAYSTACK_WEBHOOK_KEY_ID:'whk_current',PAYSTACK_WEBHOOK_SIGNING_SECRET:'whsec_current_fixture'};
 const overlap={...current,PAYSTACK_WEBHOOK_PREVIOUS_KEY_ID:'whk_previous',PAYSTACK_WEBHOOK_PREVIOUS_SIGNING_SECRET:'whsec_previous_fixture'};
 const raw=JSON.stringify({event:'charge.success',data:{domain:'test',reference,id:tx}}),ts=Math.floor(Date.now()/1000);
 const sign=secret=>createHmac('sha512',secret).update(ts+'.'+raw).digest('hex');
 let records=0;const store={record:async()=>{records++;return 'accepted';}};
 const header='t='+ts+',v1=whk_previous:'+sign(overlap.PAYSTACK_WEBHOOK_PREVIOUS_SIGNING_SECRET);
 const make=signature=>new Request(origin,{method:'POST',body:raw,headers:{'paystack-signature':signature}});
 assert.equal((await createHostedPaystackWebhook({store,signingSecrets:readPaystackSigningSecrets(overlap)})(make(header))).status,200);
 assert.equal((await createHostedPaystackWebhook({store,signingSecrets:readPaystackSigningSecrets(current)})(make(header))).status,401);
 assert.equal((await createHostedPaystackWebhook({store,signingSecrets:readPaystackSigningSecrets(overlap)})(make(header+',v1=whk_current:'+sign(current.PAYSTACK_WEBHOOK_SIGNING_SECRET)))).status,200);
 assert.equal(records,2);
 for(const config of [{},{...current,PAYSTACK_WEBHOOK_PREVIOUS_KEY_ID:'whk_previous'},{...overlap,PAYSTACK_WEBHOOK_PREVIOUS_KEY_ID:current.PAYSTACK_WEBHOOK_KEY_ID},{...current,PAYSTACK_WEBHOOK_SIGNING_SECRET:'sk_test_fixture'}])assert.throws(()=>readPaystackSigningSecrets(config));
});
test('checkout runtime fails before provider access when webhook signing is not configured',()=>{
 const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_PAYSTACK_TEST_ENABLED:'true',STUDENT_CREATORS_DISTRIBUTION_CHANNEL:'independent_web',supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',supabase_publishable_key:'sb_publishable_fixture_only_123',supabase_secret_key:'sb_secret_fixture_only_123',PAYSTACK_TEST_SECRET_KEY:'sk_test_fixture',STUDENT_CREATORS_PAYSTACK_ORIGIN:origin};
 assert.throws(()=>createHostedPaystackRuntime({env,fetcher:()=>{throw Error('unexpected network');}}));
 assert.equal(createHostedPaystackRuntime({env:{...env,PAYSTACK_WEBHOOK_KEY_ID:'whk_fixture',PAYSTACK_WEBHOOK_SIGNING_SECRET:'whsec_fixture_secret'}}).signingSecrets.length,1);
});

test('test bridge rejects live keys and privileged public credentials before I/O',()=>{const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_PROJECT_REF:'jnkqmlbkkvccnxrgkpno',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',STUDENT_CREATORS_PAYSTACK_TEST_ENABLED:'true',STUDENT_CREATORS_DISTRIBUTION_CHANNEL:'independent_web',supabase_url:'https://jnkqmlbkkvccnxrgkpno.supabase.co',supabase_publishable_key:'sb_publishable_fixture_only_123',supabase_secret_key:'sb_secret_fixture_only_123',PAYSTACK_TEST_SECRET_KEY:'sk_test_fixture',STUDENT_CREATORS_PAYSTACK_ORIGIN:origin,PAYSTACK_WEBHOOK_KEY_ID:'whk_fixture',PAYSTACK_WEBHOOK_SIGNING_SECRET:'whsec_fixture_secret'};for(const patch of [{PAYSTACK_TEST_SECRET_KEY:'sk_live_fixture'},{supabase_publishable_key:'sb_secret_fixture_only_123'},{STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'}])assert.throws(()=>createHostedPaystackRuntime({env:{...env,...patch},fetcher:()=>{throw Error('unexpected network')}}));});

test('signed transfer notifications only enqueue reference verification; never settle or trust payload amounts',async()=>{
 const secret='whsec_fixture_secret',kid='whk_fixture',ref='pt_'+'a'.repeat(32);let calls=[];
 const h=createHostedPaystackWebhook({domain:'live',signingSecrets:[{id:kid,secret}],store:{recordTransferEvent:async(...a)=>{calls.push(a);return 'accepted';}}});
 const send=async(event,domain='live',reference=ref,good=true)=>{const raw=JSON.stringify({event,data:{domain,reference,amount:1}}),ts=Math.floor(Date.now()/1000),sig=createHmac('sha512',secret).update(ts+'.'+raw).digest('hex');return h(new Request(origin,{method:'POST',body:good?raw:raw+' ',headers:{'paystack-signature':'t='+ts+',v1='+kid+':'+sig}}));};
 assert.equal((await send('transfer.reversed')).status,200);assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,2),[ref,'transfer.reversed']);assert.match(calls[0][2],/^[a-f0-9]{64}$/);
 assert.equal((await send('transfer.success','test')).status,400);assert.equal((await send('transfer.success','live','manual_transfer')).status,200);assert.equal((await send('transfer.failed','live',ref,false)).status,401);assert.equal(calls.length,1);
});
