import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {commerceFixture} from './helpers/commerce-fixture.mjs';
import {createPaystackClient} from '../../payment-core/src/paystack-client.mjs';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
const secrets=[{id:'whk_synthetic',secret:'whsec_synthetic_only'}];
function signed(f,extra={}){
 const raw=Buffer.from(JSON.stringify({event:'charge.success',data:f.response(extra).data}));
 const t=Math.floor(Date.now()/1000),sig=createHmac('sha512',secrets[0].secret).update(String(t)+'.').update(raw).digest('hex');
 return {raw,header:`t=${t},v1=${secrets[0].id}:${sig}`};
}
const client=f=>createPaystackClient({secretKey:'sk_test_SyntheticOnly',environment:'test',fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(f.response())})});
async function worker(f,mode='normal'){
 const child=fork(new URL('./helpers/fulfillment-worker.mjs',import.meta.url),[f.path,f.order.reference,mode],{stdio:['ignore','ignore','pipe','ipc']});
 const [ready]=await once(child,'message');assert.equal(ready.ready,true);return child;
}
test('simultaneous fulfillment across four real SQLite processes grants exactly once',async()=>{
 const f=commerceFixture();try{
  const children=await Promise.all(Array.from({length:4},()=>worker(f)));
  const done=children.map(c=>once(c,'message'));for(const c of children)c.send('go');
  const replies=(await Promise.all(done)).map(([m])=>m);assert.ok(replies.every(r=>r.result),JSON.stringify(replies));
  assert.equal(replies.filter(r=>!r.result.replayed).length,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_entitlements').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_receipts').get().n,1);
  assert.equal(f.store.paymentReconciliation(f.admin.user).grossKobo,20000);
 }finally{f.close();}
});
test('SIGKILL during actual fulfillment rolls back all records and permits recovery',async()=>{
 const f=commerceFixture();try{
  const child=await worker(f,'crash'),end=once(child,'exit');child.send('go');
  const [code,signal]=await end;assert.equal(signal,'SIGKILL');assert.equal(code,null);
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders').get().status,'pending');
  for(const table of ['content_entitlements','commerce_lines','commerce_receipts','commerce_journal'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  assert.equal(f.store.paymentReconciliation(f.admin.user).balanced,true);
 }finally{f.close();}
});
test('signed durable inbox survives reopen, timeout and simultaneous worker drains',async()=>{
 const f=commerceFixture();try{
  const {raw,header}=signed(f);
  assert.throws(()=>f.store.receivePaymentWebhook(Buffer.concat([raw,Buffer.from(' ')]),header,secrets),{code:'INVALID_SIGNATURE'});
  assert.equal(f.store.receivePaymentWebhook(raw,header,secrets).replayed,false);
  assert.equal(f.store.receivePaymentWebhook(raw,header,secrets).replayed,true);
  let restarted=openLocalStore(f.path);
  const timeout=createPaystackClient({secretKey:'sk_test_SyntheticOnly',environment:'test',fetchImpl:async()=>{throw Object.assign(Error('synthetic'),{name:'AbortError'});}});
  assert.equal((await restarted.drainPaymentInbox(timeout))[0].code,'GATEWAY_TIMEOUT');
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders').get().status,'pending');
  restarted.close();restarted=openLocalStore(f.path);
  f.db.exec('UPDATE payment_inbox SET next_retry_at=0');
  await Promise.all([f.store.drainPaymentInbox(client(f)),restarted.drainPaymentInbox(client(f))]);restarted.close();
  assert.equal(f.db.prepare('SELECT state FROM payment_inbox').get().state,'processed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_receipts').get().n,1);
  assert.equal(f.store.paymentReconciliation(f.admin.user).balanced,true);
 }finally{f.close();}
});
test('webhook HTTP uses exact raw bytes and durable receipt without browser authority',async()=>{
 const f=commerceFixture();try{
  const handle=createLocalHandler(f.store,{payments:{gateway:client(f),signingSecrets:secrets}}),{raw,header}=signed(f);
  const req=(signature,body=raw)=>handle(new Request('http://localhost:3000/api/local/payments/webhook',{method:'POST',headers:{'content-type':'application/json','paystack-signature':signature},body}),['payments','webhook']);
  assert.equal((await req('bad')).status,401);
  assert.equal((await req(header)).status,200);
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders').get().status,'pending');
  await f.store.drainPaymentInbox(client(f));
  assert.equal((await req(header)).status,200);
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_entitlements').get().n,1);
  assert.equal((await createLocalHandler(f.store)(new Request('http://localhost:3000/api/local/payments/webhook',{method:'POST',body:raw}),['payments','webhook'])).status,503);
 }finally{f.close();}
});
test('pending orders without callbacks can be reconciled after unknown provider status',async()=>{
 const f=commerceFixture();try{
  const pending=createPaystackClient({environment:'test',secretKey:'sk_test_SyntheticOnly',fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(f.response({status:'pending'}))})});
  const first=await f.store.recoverPendingPayments(pending);assert.equal(first[0].state,'pending');
  assert.equal(f.store.paymentReconciliation(f.admin.user).grossKobo,0);
  f.db.exec('UPDATE payment_recovery SET next_retry_at=0');
  const next=await f.store.recoverPendingPayments(client(f));assert.equal(next[0].state,'paid');
  assert.equal((await f.store.recoverPendingPayments(client(f))).length,0);
 }finally{f.close();}
});
test('recovery rotates past an older unknown payment instead of starving the next order',async(t)=>{
 // The contract orders equal-attempt orders by creation time, then reference.
 // Set distinct synthetic timestamps so random references cannot change this fixture's order.
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const f=commerceFixture();try{
  t.mock.timers.tick(1000);
  const later=f.store.createPurchaseOrder(f.other.user,f.id,'other-order-request-0001');
  assert.ok(later.createdAt>f.order.createdAt);
  const pending=Object.assign(Error('unknown'),{code:'NOT_PAID'});
  const gateway={environment:'test',verify:async order=>{if(order.reference===f.order.reference)throw pending;return {reference:later.reference,providerTransactionId:'later_synthetic_tx',amountKobo:20000,currency:'NGN',domain:'test'};}};
  const first=await f.store.recoverPendingPayments(gateway,{limit:1});
  assert.equal(first[0].state,'pending');
  assert.equal(first[0].code,'NOT_PAID');
  const next=await f.store.recoverPendingPayments(gateway,{limit:1});
  assert.equal(next[0].state,'paid');
  assert.equal(f.store.getPurchaseOrder(f.other.user,later.reference).status,'paid');
 }finally{f.close();}
});
test('inbox recovery uses already committed trusted receipts without needing the PSP again',async()=>{
 const f=commerceFixture();try{
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  const {raw,header}=signed(f);f.store.receivePaymentWebhook(raw,header,secrets);
  const gateway={environment:'test',verify:async()=>{throw Error('synthetic provider unavailable');}};
  const result=await f.store.drainPaymentInbox(gateway);
  assert.equal(result[0].state,'processed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_receipts').get().n,1);
 }finally{f.close();}
});
test('documented server-only test API key and separate signing material enable durable receipt',async()=>{
 const f=commerceFixture();
 const names=['PAYSTACK_TEST_SECRET_KEY','PAYSTACK_WEBHOOK_KEY_ID','PAYSTACK_WEBHOOK_SIGNING_SECRET'];
 const saved=names.map(n=>process.env[n]);
 try{
  process.env.PAYSTACK_TEST_SECRET_KEY='sk_test_SyntheticOnly';process.env.PAYSTACK_WEBHOOK_KEY_ID=secrets[0].id;process.env.PAYSTACK_WEBHOOK_SIGNING_SECRET=secrets[0].secret;
  const {raw,header}=signed(f);
  const response=await createLocalHandler(f.store)(new Request('http://localhost:3000/api/local/payments/webhook',{method:'POST',headers:{'paystack-signature':header},body:raw}),['payments','webhook']);
  assert.equal(response.status,200);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_inbox').get().n,1);
 }finally{names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i];});f.close();}
});
