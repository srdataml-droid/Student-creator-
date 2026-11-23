import test from 'node:test';
import assert from 'node:assert/strict';
import {commerceFixture} from './helpers/commerce-fixture.mjs';
import {createPaystackClient} from '../../payment-core/src/paystack-client.mjs';
const gateway=f=>createPaystackClient({secretKey:'sk_test_SyntheticOnly',environment:'test',fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(f.response())})});
test('immutable order snapshots and transaction identity fail closed',async()=>{
 const f=commerceFixture();try{
  const row=f.db.prepare('SELECT * FROM purchase_orders').get();
  assert.equal(row.environment,'test');assert.equal(row.currency,'NGN');assert.equal(row.platform_fee_bps,0);assert.equal(row.terms_version,'synthetic-v1');
  for(const column of ['amount_kobo','buyer_email','creator_share_kobo','environment','buyer_id','lesson_id'])assert.throws(()=>f.db.prepare(`UPDATE purchase_orders SET ${column}=?`).run('tampered'),/IMMUTABLE/);
  for(const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,' ',{}])assert.throws(()=>f.store.applyVerifiedTestCharge(f.order.reference,f.response({id})),{code:'MISSING_TRANSACTION_ID'});
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  assert.equal(f.store.paymentReconciliation(f.admin.user).balanced,true);
 }finally{f.close();}
});
test('atomic rollback after a journal failure and safe retry',()=>{
 const f=commerceFixture();try{
  f.db.exec("CREATE TRIGGER fail_finance BEFORE INSERT ON commerce_lines BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END;");
  assert.throws(()=>f.store.applyVerifiedTestCharge(f.order.reference,f.response()),/INJECTED_FAILURE/);
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders').get().status,'pending');
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_entitlements').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_receipts').get().n,0);
  f.db.exec('DROP TRIGGER fail_finance');
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  assert.equal(f.store.paymentReconciliation(f.admin.user).balanced,true);
 }finally{f.close();}
});
test('refund and chargeback append compensation once and never reactivate on late success',()=>{
 for(const kind of ['refund','chargeback']){
  const f=commerceFixture();try{
   f.store.applyVerifiedTestCharge(f.order.reference,f.response());
   const grant=f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token);
   const x=f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind,eventKey:'synthetic-reversal-01',reason:'Synthetic dispute resolution'});
   assert.equal(x.replayed,false);
   assert.equal(f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind,eventKey:'synthetic-reversal-01',reason:'Synthetic dispute resolution'}).replayed,true);
   f.store.applyVerifiedTestCharge(f.order.reference,f.response());
   assert.throws(()=>f.store.getVideoFile(f.buyer.user,f.id,grant.token,f.buyer.token),/PURCHASE_REQUIRED/);
   assert.equal(f.db.prepare('SELECT state FROM content_entitlements').get().state,'revoked');
   const r=f.store.paymentReconciliation(f.admin.user);assert.equal(r.balanced,true);assert.equal(r.creatorPendingKobo,0);assert.equal(r.grossKobo,20000);assert.equal(r.reversedKobo,20000);
   assert.equal(f.store.creatorEarnings(f.creator.user).creatorPendingKobo,0);
  }finally{f.close();}
 }
});
test('out of order reversal records verified money but never grants valid access',()=>{
 const f=commerceFixture();try{
  f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'chargeback',eventKey:'early-reversal-01',reason:'Synthetic early chargeback'});
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  assert.equal(f.db.prepare('SELECT state FROM content_entitlements').get().state,'revoked');
  assert.equal(f.store.paymentReconciliation(f.admin.user).creatorPendingKobo,0);
 }finally{f.close();}
});
test('accidental second payment is retained in duplicate liability without another entitlement',async()=>{
 const f=commerceFixture();try{
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  const response=f.response;f.response=()=>response({id:'synthetic_tx_2'});
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  const r=f.store.paymentReconciliation(f.admin.user);
  assert.equal(r.grossKobo,40000);assert.equal(r.duplicateLiabilityKobo,20000);assert.equal(r.creatorPendingKobo,20000);assert.equal(r.balanced,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_entitlements').get().n,1);
  assert.throws(()=>f.db.exec('DELETE FROM commerce_lines'),/APPEND_ONLY/);
 }finally{f.close();}
});
test('refund updates outward payment state; balanced numbers alone cannot hide missing journals',()=>{
 const f=commerceFixture();try{
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'refund',eventKey:'status-refund-0001',reason:'Synthetic refund state check'});
  assert.equal(f.store.getPurchaseOrder(f.buyer.user,f.order.reference).status,'refunded');
  f.db.prepare('INSERT INTO commerce_receipts VALUES(?,?,?,?,?,?)').run('orphan_test_receipt',f.order.reference,20000,0,1,new Date().toISOString());
  assert.equal(f.store.paymentReconciliation(f.admin.user).balanced,false);
 }finally{f.close();}
});
test('database rejects cross-account entitlements and unbalanced journal sealing',()=>{
 const f=commerceFixture();try{
  assert.throws(()=>f.db.prepare('INSERT INTO content_entitlements(buyer_id,lesson_id,order_reference,granted_at) VALUES(?,?,?,?)').run(f.other.user.id,f.id,f.order.reference,new Date().toISOString()),/INVALID_ENTITLEMENT/);
  f.db.prepare("INSERT INTO commerce_events VALUES(?,?,?,'draft',?)").run('bad-journal',f.order.reference,'synthetic',new Date().toISOString());
  f.db.prepare('INSERT INTO commerce_lines VALUES(?,?,?,?,?)').run('bad-journal',1,'processor_clearing',20000,0);
  assert.throws(()=>f.db.exec("UPDATE commerce_events SET state='posted' WHERE event_key='bad-journal'"),/UNBALANCED_JOURNAL/);
 }finally{f.close();}
});
test('refund targets the original transaction; a later duplicate remains a separate liability',async()=>{
 const f=commerceFixture();try{
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'refund',eventKey:'primary-refund-0001',reason:'Synthetic original refund'});
  const original=f.response;f.response=()=>original({id:'late_duplicate_tx'});
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  const r=f.store.paymentReconciliation(f.admin.user);assert.equal(r.reversedKobo,20000);assert.equal(r.duplicateLiabilityKobo,20000);
  f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'refund',eventKey:'duplicate-refund-01',transactionId:'late_duplicate_tx',reason:'Synthetic duplicate refund'});
  assert.equal(f.store.paymentReconciliation(f.admin.user).duplicateLiabilityKobo,0);
 }finally{f.close();}
});
test('database cannot create a sealed journal without balanced lines',()=>{
 const f=commerceFixture();try{
  assert.throws(()=>f.db.prepare("INSERT INTO commerce_events VALUES(?,?,?,'posted',?)").run('invalid-sealed',f.order.reference,'charge',new Date().toISOString()),/DRAFT_REQUIRED/);
 }finally{f.close();}
});
test('verification mismatch matrix cannot persist any payment or entitlement',()=>{
 const cases=[{reference:'wrong_reference'},{amount:1},{currency:'USD'},{domain:'live'},{customer:{email:'other@example.invalid'}},{status:'failed'},{status:'pending'},{id:null},{fees:-1}];
 const f=commerceFixture();try{
  for(const data of cases){
   assert.throws(()=>f.store.applyVerifiedTestCharge(f.order.reference,f.response(data)));
   assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_receipts').get().n,0);
   assert.equal(f.db.prepare('SELECT count(*) n FROM content_entitlements').get().n,0);
   assert.equal(f.db.prepare('SELECT status FROM purchase_orders').get().status,'pending');
  }
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  const other=f.store.createPurchaseOrder(f.other.user,f.id,'other-test-request-0001');
  assert.throws(()=>f.store.applyVerifiedTestCharge(other.reference,f.response({reference:other.reference,customer:{email:'other@example.invalid'}})),/PROVIDER_TRANSACTION_REUSED/);
 }finally{f.close();}
});
test('early reversal audit reports revoked access instead of claiming an active grant',()=>{
 const f=commerceFixture();try{
  f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'chargeback',eventKey:'audit-early-reversal',reason:'Synthetic early reversal audit'});
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_events WHERE action='purchase.payment.recorded_access_revoked'").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_events WHERE action='purchase.entitlement.granted'").get().n,0);
 }finally{f.close();}
});
test('refunding only a duplicate does not revoke the original paid entitlement',async()=>{
 const f=commerceFixture();try{
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  const original=f.response;f.response=()=>original({id:'duplicate_only_refund_tx'});
  await f.store.reconcilePurchase(f.buyer.user,f.order.reference,gateway(f));
  f.store.simulatePaymentReversal(f.admin.user,f.order.reference,{kind:'refund',eventKey:'duplicate-only-refund',transactionId:'duplicate_only_refund_tx',reason:'Synthetic duplicate only refund'});
  assert.equal(f.store.getPurchaseOrder(f.buyer.user,f.order.reference).status,'paid');
  assert.equal(f.store.creatorEarnings(f.creator.user).creatorPendingKobo,20000);
  f.db.exec("UPDATE content_entitlements SET state='active'");
  assert.ok(f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token));
 }finally{f.close();}
});
