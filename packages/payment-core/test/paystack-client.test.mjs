import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaystackClient, PaystackGatewayError } from '../src/paystack-client.mjs';

const order = Object.freeze({ reference:'ord_20261119_abcd1234', buyerEmail:'student@example.edu.ng', amountKobo:20_000, domain:'test' });
const key = 'sk_test_mockSecretForContractTests';
const ok = (data) => ({ ok:true, status:200, text:async()=>JSON.stringify({status:true,data}) });
const init = (url='https://checkout.paystack.com/abc') => ({ authorization_url:url, reference:order.reference });
const verified = () => ({ status:'success', reference:order.reference, amount:20_000, currency:'NGN', domain:'test', id: 123, customer:{email:order.buyerEmail} });
const code = (fn, code) => assert.rejects(fn, e=>e instanceof PaystackGatewayError && e.code===code);

test('rejects invalid secret and mismatched live/test configuration', ()=>{
  assert.throws(()=>createPaystackClient({secretKey:'',environment:'test'}), /secret/);
  assert.throws(()=>createPaystackClient({secretKey:key,environment:'live'}), /disagree/);
});
test('initializes exactly one trusted order with kobo and no access-grant shortcut',async()=>{
  let captured;
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async (url,options)=>{captured={url,options};return ok(init())}});
  const result=await api.initialize(order);
  assert.equal(result.authorizationUrl,'https://checkout.paystack.com/abc');
  assert.equal(captured.url,'https://api.paystack.co/transaction/initialize');
  assert.equal(captured.options.method,'POST');
  assert.equal(captured.options.redirect,'error');
  assert.deepEqual(JSON.parse(captured.options.body),{email:order.buyerEmail,amount:20_000,currency:'NGN',reference:order.reference,channels:['card','bank','ussd','bank_transfer']});
});
test('refuses initialization with amount below ₦200 or untrusted email',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>{throw Error('transport should not run')}});
  await code(()=>api.initialize({...order,amountKobo:19999}),'BAD_ORDER');
  await code(()=>api.initialize({...order,buyerEmail:'not an email'}),'BAD_ORDER');
});
test('rejects checkout URL redirect to attacker domain',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>ok(init('https://checkout.paystack.com.evil.example/abc'))});
  await code(()=>api.initialize(order),'BAD_GATEWAY_RESPONSE');
});
test('rejects initialization reference substitution',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>ok({...init(),reference:'different'})});
  await code(()=>api.initialize(order),'BAD_GATEWAY_RESPONSE');
});
test('server-side Paystack verification returns matching authoritative transaction evidence',async()=>{
  let requested;
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async (url,options)=>{requested={url,options};return ok(verified())}});
  const result=await api.verify(order);
  assert.equal(result.providerTransactionId,'123');
  assert.equal(requested.options.method,'GET');
  assert.equal(requested.url,`https://api.paystack.co/transaction/verify/${order.reference}`);
});
test('does not confirm a pending charge',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>ok({...verified(),status:'pending'})});
  await code(()=>api.verify(order),'NOT_PAID');
});
test('fails closed when Paystack verifies different buyer or amount',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>ok({...verified(),amount:25_000})});
  await code(()=>api.verify(order),'AMOUNT_MISMATCH');
});
test('handles gateway HTTP 503 without assuming transaction failed',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>({ok:false,status:503,text:async()=>JSON.stringify({status:false,message:'down'})})});
  await code(()=>api.verify(order),'GATEWAY_HTTP_ERROR');
});
test('rejects provider JSON error bodies and invalid JSON',async()=>{
  const bad=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>({ok:true,status:200,text:async()=>'{broken'})});
  await code(()=>bad.verify(order),'BAD_GATEWAY_RESPONSE');
  const declined=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({status:false,message:'bad ref'})})});
  await code(()=>declined.verify(order),'GATEWAY_REJECTED');
});
test('safe provider network failure without leaking email, reference, or secret',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>{throw new Error('request included '+key+' '+order.buyerEmail)}});
  await assert.rejects(api.verify(order),e=>e.code==='GATEWAY_NETWORK_ERROR'&&!e.message.includes(key)&&!e.message.includes(order.buyerEmail));
});
test('aborted provider request reports unknown state requiring reconciliation',async()=>{
  const api=createPaystackClient({secretKey:key,environment:'test',fetchImpl:async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'})}});
  await code(()=>api.verify(order),'GATEWAY_TIMEOUT');
});
