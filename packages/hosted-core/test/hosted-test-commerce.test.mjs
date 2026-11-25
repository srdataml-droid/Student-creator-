import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createHostedPaymentRpc,createHostedTestCommerce,createConfiguredHostedRecovery} from '../src/hosted-test-commerce.mjs';
const buyer='50000000-0000-4000-8000-000000000002',content='50000000-0000-4000-8000-000000000007',lease='50000000-0000-4000-8000-000000000008',reference='sc_'+'a'.repeat(32);
const snapshot={orderId:content,reference,amountKobo:20000,buyerEmail:'buyer@example.invalid',domain:'test',currency:'NGN',status:'pending'};
const verified={reference,amountKobo:20000,currency:'NGN',domain:'test',providerTransactionId:'tx1',providerFeeKobo:100};
function fixture(patch={}){
 const calls=[];const rpc=async(action,params)=>{calls.push({action,params});if(action==='lookup')return snapshot;if(action==='create')return {order_id:content,reference,amount_kobo:20000,currency:'NGN',status:'pending'};if(action==='claim')return {...snapshot,transactionId:'tx1',lease};if(action==='finish')return {owned:true,state:params.p_error?'failed':'processed'};return {status:'paid'};};
 const gateway={environment:'test',initialize:async()=>{throw Error('Not exposed');},verify:async()=>verified};
 const authenticate=async()=>({userId:buyer,email:'buyer@example.invalid',emailConfirmed:true,currentSession:true,eligible:true});
 return {calls,service:createHostedTestCommerce({rpc,gateway,authenticate,...patch})};
}
test('server chooses buyer identity, amount and reference, ignores injected client terms',async()=>{
 const f=fixture();const r=await f.service.createOrder('token',{contentId:content,requestKey:'request-key-123456',amountKobo:1,buyerId:content,reference:'forged'});
 assert.equal(r.amountKobo,20000);assert.deepEqual(f.calls[0],{action:'create',params:{p_buyer:buyer,p_email:'buyer@example.invalid',p_content:content,p_key:'request-key-123456'}});
 assert.equal((await f.service.getOrder('token',reference)).buyerEmail,undefined);
});
test('requires current verified eligible identity before RPC',async()=>{
 for(const patch of [{emailConfirmed:false},{currentSession:false},{eligible:false}]){
 const f=fixture({authenticate:async()=>({userId:buyer,email:'buyer@example.invalid',emailConfirmed:true,currentSession:true,eligible:true,...patch})});
 await assert.rejects(f.service.confirmOrder('token',reference),{code:'AUTH_REQUIRED'});assert.equal(f.calls.length,0);
 }
});
test('verified provider evidence only then applies trusted charge',async()=>{
 const f=fixture();assert.equal((await f.service.confirmOrder('token',reference)).status,'paid');
 assert.deepEqual(f.calls[1],{action:'apply',params:{p_ref:reference,p_tx:'tx1',p_amount:20000,p_currency:'NGN',p_domain:'test',p_email:'buyer@example.invalid',p_fee:100}});
});
test('mismatched amount, currency, environment or leased transaction never applied',async()=>{
 for(const patch of [{amountKobo:1},{currency:'USD'},{domain:'live'},{providerTransactionId:'other'}]){
 const f=fixture({gateway:{environment:'test',initialize:async()=>{},verify:async()=>({...verified,...patch})}});
 assert.equal((await f.service.drainOne()).state,'failed');
 assert.equal(f.calls.some(x=>x.action==='apply'),false);assert.equal(f.calls.at(-1).params.p_error,'PAYMENT_VERIFICATION_FAILED');
 }
});
test('worker applies before finishing and returns no buyer data',async()=>{
 const f=fixture();assert.deepEqual(await f.service.drainOne(),{state:'processed'});
 assert.deepEqual(f.calls.map(x=>x.action),['claim','apply','finish']);
});
test('worker propagates completion transport uncertainty instead of reporting success',async()=>{
 const f=fixture({rpc:async action=>{if(action==='claim')return {...snapshot,transactionId:'tx1',lease};if(action==='finish')throw Error('network');return {status:'paid'};}});
 await assert.rejects(f.service.drainOne(),/network/);
});
test('signed charge delivery queues reference and digest only; never fulfills from payload',async()=>{
 const key={id:'whk_fixture',secret:'whsec_fixture_secret'};const f=fixture({signingSecrets:[key]});
 const raw=Buffer.from(JSON.stringify({event:'charge.success',data:{domain:'test',id:'tx1',reference,amount:1,customer:{email:'private@example.invalid'}}}));
 const t=Math.floor(Date.now()/1000),sign=createHmac('sha512',key.secret).update(Buffer.concat([Buffer.from(t+'.'),raw])).digest('hex');
 await assert.rejects(f.service.receiveWebhook(raw,'invalid'),{code:'INVALID_SIGNATURE'});
 await f.service.receiveWebhook(raw,'t='+t+',v1='+key.id+':'+sign);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'enqueue');assert.deepEqual(Object.keys(f.calls[0].params).sort(),['p_digest','p_ref','p_tx']);
});
test('RPC only sends secret via apikey to exact project and allowlisted path',async()=>{
 const projectRef='a'.repeat(20),url='https://'+projectRef+'.supabase.co',serverKey='sb_secret_fixture_not_real_123';let captured;
 const rpc=createHostedPaymentRpc({url,projectRef,serverKey,fetchImpl:async(u,o)=>{captured={u,o};return new Response(JSON.stringify({ok:true}));}});
 assert.deepEqual(await rpc('claim'),{ok:true});assert.equal(captured.u,url+'/rest/v1/rpc/week05_claim_test_charge');assert.equal(captured.o.headers.apikey,serverKey);assert.equal(captured.o.headers.authorization,undefined);assert.equal(captured.o.redirect,'error');
 await assert.rejects(rpc('../auth/users'),{code:'UNKNOWN_PAYMENT_RPC'});assert.throws(()=>createHostedPaymentRpc({url:'https://evil.example',projectRef,serverKey}),{code:'HOSTED_PAYMENT_CONFIGURATION'});
});
test('recovery opt-in and test-only gateway required',()=>{
 assert.throws(()=>createConfiguredHostedRecovery({}),{code:'HOSTED_RECOVERY_DISABLED'});
 assert.throws(()=>createHostedTestCommerce({rpc:async()=>{},gateway:{environment:'live'}}),{code:'HOSTED_TEST_PAYMENT_CONFIGURATION'});
});

test('checkout claims before network, persists ready URL then rechecks buyer and gate',async()=>{
 const events=[];const f=fixture({distributionChannel:'independent_web',rpc:async(action,params)=>{events.push(action);if(action==='beginCheckout')return {...snapshot,state:'claimed',claim:lease,checkoutAllowed:true};if(action==='lookup')return {...snapshot,checkoutAllowed:true};if(action==='finishCheckout'){assert.equal(params.p_url,'https://checkout.paystack.com/test');return {owned:true,state:'ready'};}throw Error('unexpected');},gateway:{environment:'test',verify:async()=>verified,initialize:async(order)=>{events.push('provider');assert.equal(order.amountKobo,20000);return {reference,authorizationUrl:'https://checkout.paystack.com/test'};}}});
 assert.deepEqual(await f.service.initializeOrder('token',reference),{reference,authorizationUrl:'https://checkout.paystack.com/test'});
 assert.deepEqual(events,['beginCheckout','provider','finishCheckout','lookup']);
});
test('cached URL validation and distribution gate prevent bypass of provider checks',async()=>{
 for(const authorizationUrl of ['https://checkout.paystack.com.evil.invalid/test','https://user@checkout.paystack.com/test','https://checkout.paystack.com/test#fragment','https://checkout.paystack.com:8443/test']){
  const f=fixture({distributionChannel:'independent_web',rpc:async()=>({state:'ready',reference,authorizationUrl})});
  await assert.rejects(f.service.initializeOrder('token',reference),{code:'INVALID_CHECKOUT_RESPONSE'});
 }
 const f=fixture({distributionChannel:'google_play'});
 await assert.rejects(f.service.initializeOrder('token',reference),{code:'CHECKOUT_DISTRIBUTION_DISABLED'});
 assert.equal(f.calls.length,0);
});
test('uncertain initialization never calls the provider or creates a new reference',async()=>{
 const f=fixture({distributionChannel:'independent_web',rpc:async()=>({state:'uncertain',reference})});
 await assert.rejects(f.service.initializeOrder('token',reference),{code:'CHECKOUT_INITIALIZATION_UNCERTAIN'});
});
test('failed provider call persists uncertainty instead of retrying',async()=>{
 const events=[];const f=fixture({distributionChannel:'independent_web',rpc:async(action,params)=>{events.push(action);if(action==='beginCheckout')return {...snapshot,state:'claimed',claim:lease,checkoutAllowed:true};assert.equal(params.p_url,null);return {owned:true,state:'uncertain'};},gateway:{environment:'test',verify:async()=>verified,initialize:async()=>{events.push('provider');throw Object.assign(Error('secret response omitted'),{code:'GATEWAY_TIMEOUT'});}}});
 await assert.rejects(f.service.initializeOrder('token',reference),{code:'GATEWAY_TIMEOUT'});
 assert.deepEqual(events,['beginCheckout','provider','finishCheckout']);
});
