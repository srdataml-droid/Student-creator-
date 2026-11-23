/** Local SQLite commerce only. Synthetic settlement is NOT a Paystack callback. */
import {randomBytes,createHash} from 'node:crypto';
import {migrateCommerce} from './commerce-schema.mjs';
import {decodeVerifiedPaystackWebhookV1} from '../../payment-core/src/webhooks.mjs';
import {quoteLessonPurchase,validateVerifiedCharge} from '../../payment-core/src/payments.mjs';
export function createLocalCommerce({db,transaction,audit,error,requireVerified,requireCreatorAction}){
 db.exec([
 'CREATE TABLE IF NOT EXISTS lesson_prices(lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,amount_kobo INTEGER NOT NULL CHECK(amount_kobo>=20000));',
 "CREATE TABLE IF NOT EXISTS purchase_orders(reference TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES users(id),creator_id TEXT NOT NULL REFERENCES users(id),lesson_id TEXT NOT NULL REFERENCES lessons(id),buyer_email TEXT NOT NULL,amount_kobo INTEGER NOT NULL CHECK(amount_kobo>=20000),creator_share_kobo INTEGER NOT NULL CHECK(creator_share_kobo>=0),status TEXT NOT NULL CHECK(status IN ('pending','paid')),request_key TEXT NOT NULL,provider_transaction_id TEXT UNIQUE,created_at TEXT NOT NULL,paid_at TEXT,UNIQUE(buyer_id,request_key),UNIQUE(buyer_id,lesson_id));",
 'CREATE TABLE IF NOT EXISTS content_entitlements(buyer_id TEXT NOT NULL REFERENCES users(id),lesson_id TEXT NOT NULL REFERENCES lessons(id),order_reference TEXT NOT NULL UNIQUE REFERENCES purchase_orders(reference),granted_at TEXT NOT NULL,PRIMARY KEY(buyer_id,lesson_id));',
 "CREATE TABLE IF NOT EXISTS commerce_journal(order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),line_no INTEGER NOT NULL,account TEXT NOT NULL CHECK(account IN ('processor_clearing','creator_payable')),debit_kobo INTEGER NOT NULL DEFAULT 0 CHECK(debit_kobo>=0),credit_kobo INTEGER NOT NULL DEFAULT 0 CHECK(credit_kobo>=0),created_at TEXT NOT NULL,PRIMARY KEY(order_reference,line_no),CHECK((debit_kobo>0 AND credit_kobo=0) OR (credit_kobo>0 AND debit_kobo=0)));",
 "CREATE TABLE IF NOT EXISTS synthetic_refunds(order_reference TEXT PRIMARY KEY REFERENCES purchase_orders(reference),refund_reference TEXT NOT NULL UNIQUE,original_provider_transaction_id TEXT NOT NULL,created_at TEXT NOT NULL);"
 ].join('\n'));
 migrateCommerce(db,transaction);
 const price=id=>db.prepare('SELECT amount_kobo FROM lesson_prices WHERE lesson_id=?').get(id)?.amount_kobo??0;
 const snapshot=r=>({reference:r.reference,lessonId:r.lesson_id,amountKobo:r.amount_kobo,currency:'NGN',status:r.payment_state,creatorShareKobo:r.creator_share_kobo,createdAt:r.created_at,paidAt:r.paid_at,environment:r.environment,termsVersion:r.terms_version,feePolicy:r.fee_policy});
 const published=id=>db.prepare("SELECT l.id,l.creator_id,l.status,c.active AS active FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=?").get(id);
 function setPrice(actor,id,amountKobo){
  requireVerified(actor);
  if(!Number.isSafeInteger(amountKobo)||(amountKobo!==0&&amountKobo<20000)||amountKobo>1000000000)throw error('INVALID_LESSON_PRICE',422);
  return transaction(()=>{
   const l=published(id);
   if(!l)throw error('LESSON_NOT_FOUND',404);
   if(l.creator_id!==actor.id)throw error('FORBIDDEN',403);
   if(!['draft','rejected'].includes(l.status))throw error('PRICE_LOCKED',409);
   if(db.prepare('SELECT 1 FROM purchase_orders WHERE lesson_id=?').get(id))throw error('PRICE_LOCKED',409);
   if(amountKobo===0)db.prepare('DELETE FROM lesson_prices WHERE lesson_id=?').run(id);
   else db.prepare('INSERT INTO lesson_prices(lesson_id,amount_kobo) VALUES(?,?) ON CONFLICT(lesson_id) DO UPDATE SET amount_kobo=excluded.amount_kobo').run(id,amountKobo);
   audit(actor.id,'lesson.price.updated',id,{amountKobo});
   return {lessonId:id,priceKobo:amountKobo,currency:'NGN'};
  });
 }
 function requireAccess(actor,id,creatorId){
  if(price(id)===0||actor?.id===creatorId||actor?.role==='admin')return true;
  requireVerified(actor);
  if(!db.prepare("SELECT 1 FROM content_entitlements WHERE buyer_id=? AND lesson_id=? AND state='active'").get(actor.id,id))throw error('PURCHASE_REQUIRED',402);
  return true;
 }
 function createOrder(actor,id,key){
  requireVerified(actor);
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(key))throw error('INVALID_IDEMPOTENCY_KEY',422);
  return transaction(()=>{
   const oldKey=db.prepare('SELECT * FROM purchase_orders WHERE buyer_id=? AND request_key=?').get(actor.id,key);
   if(oldKey){if(oldKey.lesson_id!==id)throw error('IDEMPOTENCY_CONFLICT',409);return {...snapshot(oldKey),replayed:true};}
   const lesson=published(id);
   if(!lesson||lesson.status!=='published'||!lesson.active)throw error('LESSON_NOT_FOUND',404);
   requireCreatorAction(actor,lesson.creator_id,'view');
   if(actor.id===lesson.creator_id)throw error('SELF_PURCHASE_FORBIDDEN',403);
   const amountKobo=price(id);
   if(!amountKobo)throw error('FREE_LESSON',409);
   const oldLesson=db.prepare('SELECT * FROM purchase_orders WHERE buyer_id=? AND lesson_id=?').get(actor.id,id);
   if(oldLesson)return {...snapshot(oldLesson),replayed:true};
   const buyer=db.prepare('SELECT email FROM users WHERE id=?').get(actor.id);
   if(!buyer)throw error('AUTH_REQUIRED',401);
   // No commercial commission is charged until the founder approves a fee policy.
   const quote=quoteLessonPurchase(amountKobo,0),reference='sc_'+randomBytes(20).toString('hex'),now=new Date().toISOString();
   db.prepare("INSERT INTO purchase_orders(reference,buyer_id,creator_id,lesson_id,buyer_email,amount_kobo,creator_share_kobo,status,request_key,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
    .run(reference,actor.id,lesson.creator_id,id,buyer.email,amountKobo,quote.creatorGrossShareKobo,key,now);
   audit(actor.id,'purchase.order.created',reference,{lessonId:id});
   return {...snapshot(db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference)),replayed:false};
  });
 }
 function post(reference,key,kind,lines){
  if(db.prepare('SELECT 1 FROM commerce_events WHERE event_key=?').get(key))return;
  db.prepare("INSERT INTO commerce_events VALUES(?,?,?,'draft',?)").run(key,reference,kind,new Date().toISOString());
  let n=0;
  for(const [account,debit,credit] of lines)if(debit||credit)db.prepare('INSERT INTO commerce_lines VALUES(?,?,?,?,?)').run(key,++n,account,debit,credit);
  db.prepare("UPDATE commerce_events SET state='posted' WHERE event_key=?").run(key);
 }
 function dispute(reference,key,kind){
  db.prepare('INSERT OR IGNORE INTO payment_disputes(case_key,order_reference,kind,created_at) VALUES(?,?,?,?)').run(key,reference,kind,new Date().toISOString());
 }
 function compensate(order){
  const current=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(order.reference);
  for(const receipt of db.prepare('SELECT * FROM commerce_receipts WHERE order_reference=?').all(order.reference)){
   if(db.prepare('SELECT 1 FROM commerce_reversals WHERE order_reference=? AND (transaction_id=? OR (transaction_id IS NULL AND ?=0))').get(order.reference,receipt.transaction_id,receipt.duplicate))
    post(order.reference,'reverse:'+receipt.transaction_id,'reversal',[[receipt.duplicate?'duplicate_payable':'creator_payable',receipt.amount_kobo,0],['processor_clearing',0,receipt.amount_kobo]]);
  }
  const primaryReversals=db.prepare('SELECT kind FROM commerce_reversals WHERE order_reference=? AND (transaction_id IS NULL OR transaction_id=?)').all(order.reference,current.provider_transaction_id);
  if(!primaryReversals.length)return;
  if(current.status==='paid'&&!db.prepare('SELECT 1 FROM commerce_journal WHERE order_reference=? AND line_no=3').get(order.reference)){
   const now=new Date().toISOString();
   db.prepare('INSERT INTO commerce_journal VALUES(?,?,?,?,?,?)').run(order.reference,3,'creator_payable',order.creator_share_kobo,0,now);
   db.prepare('INSERT INTO commerce_journal VALUES(?,?,?,?,?,?)').run(order.reference,4,'processor_clearing',0,order.amount_kobo,now);
  }
  db.prepare('UPDATE purchase_orders SET payment_state=? WHERE reference=?').run(primaryReversals.some(r=>r.kind==='chargeback')?'chargeback':'refunded',order.reference);
  db.prepare("UPDATE content_entitlements SET state='revoked' WHERE order_reference=?").run(order.reference);
  db.prepare('DELETE FROM playback_grants WHERE user_id=? AND lesson_id=?').run(order.buyer_id,order.lesson_id);
 }
 function completeInbox(reference,transactionId){
  db.prepare("UPDATE payment_inbox SET state='processed',last_error_code=NULL WHERE order_reference=? AND transaction_id=?").run(reference,transactionId);
 }
 function restrictionDispute(reference){
  if(db.prepare("SELECT 1 FROM payment_disputes WHERE order_reference=? AND kind='creator_view_restriction' AND status='open'").get(reference))return;
  const n=db.prepare("SELECT count(*) n FROM payment_disputes WHERE order_reference=? AND kind='creator_view_restriction'").get(reference).n;
  dispute(reference,'block:'+reference+':'+(n+1),'creator_view_restriction');
 }
 function applyTrustedCharge(reference,charge,{retainDuplicate=false}={}){
  return transaction(()=>{
   const order=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);
   if(!order)throw error('ORDER_NOT_FOUND',404);
   if(!charge||charge.reference!==order.reference||charge.amountKobo!==order.amount_kobo||charge.currency!=='NGN'||charge.domain!=='test'||typeof charge.providerTransactionId!=='string'||!charge.providerTransactionId)
    throw error('PAYMENT_CONFLICT',409);
   const receipt=db.prepare('SELECT * FROM commerce_receipts WHERE transaction_id=?').get(charge.providerTransactionId);
   if(receipt){
    if(receipt.order_reference!==reference)throw error('PROVIDER_TRANSACTION_REUSED',409);
    completeInbox(reference,charge.providerTransactionId);
    return {...snapshot(order),replayed:true};
   }
   const duplicate=order.status==='paid';
   if(duplicate&&!retainDuplicate)throw error('PAYMENT_CONFLICT',409);
   const now=new Date().toISOString();
   db.prepare('INSERT INTO commerce_receipts VALUES(?,?,?,?,?,?)').run(charge.providerTransactionId,reference,order.amount_kobo,charge.providerFeeKobo??0,Number(duplicate),now);
   post(reference,'charge:'+charge.providerTransactionId,duplicate?'duplicate_charge':'charge',[
    ['processor_clearing',order.amount_kobo,0],[duplicate?'duplicate_payable':'creator_payable',0,order.creator_share_kobo]]);
   if(charge.providerFeeKobo)post(reference,'fee:'+charge.providerTransactionId,'provider_fee',[
    ['provider_fee_suspense',charge.providerFeeKobo,0],['processor_clearing',0,charge.providerFeeKobo]]);
   if(duplicate){dispute(reference,'duplicate:'+charge.providerTransactionId,'duplicate_payment');}
   else{
    db.prepare("UPDATE purchase_orders SET status='paid',payment_state='paid',provider_transaction_id=?,paid_at=? WHERE reference=? AND status='pending'").run(charge.providerTransactionId,now,reference);
    db.prepare('INSERT INTO content_entitlements(buyer_id,lesson_id,order_reference,granted_at) VALUES(?,?,?,?)').run(order.buyer_id,order.lesson_id,reference,now);
    db.prepare('INSERT INTO commerce_journal VALUES(?,?,?,?,?,?)').run(reference,1,'processor_clearing',order.amount_kobo,0,now);
    db.prepare('INSERT INTO commerce_journal VALUES(?,?,?,?,?,?)').run(reference,2,'creator_payable',0,order.creator_share_kobo,now);
   }
   compensate(order);
   completeInbox(reference,charge.providerTransactionId);
   if(db.prepare('SELECT 1 FROM creator_restrictions WHERE creator_id=? AND viewer_id=? AND deny_view=1').get(order.creator_id,order.buyer_id))restrictionDispute(reference);
   const finalOrder=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);
   audit(order.buyer_id,duplicate?'purchase.duplicate.recorded':finalOrder.payment_state==='paid'?'purchase.entitlement.granted':'purchase.payment.recorded_access_revoked',reference,{lessonId:order.lesson_id});
   return {...snapshot(db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference)),replayed:false,duplicate};
  });
 }
 /**
  * Test-only direct injection; may receive fabricated verificationResponse.
  * NEVER expose via HTTP, webhook or production callbacks. Real settlement
  * must call the Paystack API with a test key before this state transition.
  */
 function testVerification(reference,response){
  if(process.env.NODE_ENV==='production')throw error('TEST_SETTLEMENT_DISABLED',403);
  const order=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);
  if(!order)throw error('ORDER_NOT_FOUND',404);
  const charge=validateVerifiedCharge({reference:order.reference,amountKobo:order.amount_kobo,buyerEmail:order.buyer_email,domain:'test'},response);
  return applyTrustedCharge(reference,charge);
 }
 function trustedOrder(actor,reference){
  requireVerified(actor);
  const r=db.prepare('SELECT * FROM purchase_orders WHERE reference=? AND buyer_id=?').get(reference,actor.id);
  if(!r)throw error('ORDER_NOT_FOUND',404);
  return r;
 }
 function orderStatus(actor,reference){return snapshot(trustedOrder(actor,reference));}
 async function sandboxCheckout(actor,reference,gateway){
  requireSandbox();
  const row=trustedOrder(actor,reference);
  if(row.payment_state!=='pending')throw error('ALREADY_PURCHASED',409);
  requireCreatorAction(actor,row.creator_id,'view');
  if(gateway?.environment!=='test'||typeof gateway.initialize!=='function')throw error('SANDBOX_PAYMENTS_UNAVAILABLE',503);
  return gateway.initialize({reference:row.reference,buyerEmail:row.buyer_email,amountKobo:row.amount_kobo,domain:'test'});
 }
 async function confirmSandboxOrder(actor,reference,gateway){return reconcilePurchase(actor,reference,gateway);}
 function applySyntheticRefund(reference,{refundReference,providerTransactionId}={}){
  if(process.env.NODE_ENV==='production')throw error('TEST_REFUND_DISABLED',403);
  if(typeof refundReference!=='string'||!/^[A-Za-z0-9._-]{8,160}$/.test(refundReference))
   throw error('INVALID_REFUND_EVIDENCE',422);
  return transaction(()=>{
   const order=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);
   if(!order)throw error('ORDER_NOT_FOUND',404);
   if(order.status!=='paid'||typeof providerTransactionId!=='string'||
      order.provider_transaction_id!==providerTransactionId)throw error('INVALID_REFUND_EVIDENCE',422);
   const old=db.prepare('SELECT * FROM synthetic_refunds WHERE order_reference=?').get(reference);
   if(old){
    if(old.refund_reference!==refundReference)throw error('REFUND_CONFLICT',409);
    return {...snapshot(order),replayed:true};
   }
   const now=new Date().toISOString();
   db.prepare('INSERT INTO synthetic_refunds(order_reference,refund_reference,original_provider_transaction_id,created_at) VALUES(?,?,?,?)')
    .run(reference,refundReference,providerTransactionId,now);
   db.prepare('INSERT INTO commerce_reversals VALUES(?,?,?,?,?,?)').run('legacy-refund:'+refundReference,reference,'refund',providerTransactionId,'Synthetic test harness refund',now);
   compensate(order);
   audit(order.buyer_id,'purchase.synthetic_refund.recorded',reference);
   return {...snapshot(db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference)),replayed:false};
  });
 }
 function ownOrders(actor){requireVerified(actor);return db.prepare('SELECT * FROM purchase_orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100').all(actor.id).map(snapshot);}
 function creatorEarnings(actor){
  requireVerified(actor);
  const r=db.prepare("SELECT COALESCE(SUM(creator_share_kobo),0) AS pending,COUNT(*) AS count FROM purchase_orders WHERE creator_id=? AND status='paid' AND payment_state='paid'").get(actor.id);
  return {currency:'NGN',creatorPendingKobo:r.pending,paidOrders:r.count,payoutEnabled:false,commissionApproved:false};
 }
 function lessonAccess(actor,id){
  requireVerified(actor);
  const l=published(id);if(!l||l.status!=='published'||!l.active)throw error('LESSON_NOT_FOUND',404);
  requireCreatorAction(actor,l.creator_id,'view');
  const amountKobo=price(id),owned=actor.id===l.creator_id;
  return {lessonId:id,priceKobo:amountKobo,currency:'NGN',
   entitled:owned||!amountKobo||Boolean(db.prepare("SELECT 1 FROM content_entitlements WHERE buyer_id=? AND lesson_id=? AND state='active'").get(actor.id,id)),
   creatorOwned:owned,checkoutEnabled:false};
 }
 function requireSandbox(){if(process.env.NODE_ENV==='production')throw error('SANDBOX_PAYMENTS_DISABLED',403);}
 function requireFinance(actor){
  if(!actor||!db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND suspended=0").get(actor.id))throw error('ADMIN_REQUIRED',403);
 }
 async function reconcileReference(reference,gateway,expectedTransaction=null){
  requireSandbox();
  const row=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);
  if(!row)throw error('ORDER_NOT_FOUND',404);
  if(gateway?.environment!=='test'||typeof gateway.verify!=='function')throw error('SANDBOX_PAYMENTS_UNAVAILABLE',503);
  const charge=await gateway.verify({reference:row.reference,buyerEmail:row.buyer_email,amountKobo:row.amount_kobo,domain:row.environment});
  if(expectedTransaction!==null&&charge.providerTransactionId!==expectedTransaction)throw error('TRANSACTION_MISMATCH',409);
  return applyTrustedCharge(reference,charge,{retainDuplicate:true});
 }
 async function reconcilePurchase(actor,reference,gateway){trustedOrder(actor,reference);return reconcileReference(reference,gateway);}
 function simulateReversal(actor,reference,{kind,eventKey,reason,transactionId=null}={}){
  requireSandbox();requireFinance(actor);
  if(!['refund','chargeback'].includes(kind)||typeof eventKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(eventKey)||typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw error('INVALID_REVERSAL',422);
  return transaction(()=>{
   const order=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);if(!order)throw error('ORDER_NOT_FOUND',404);
   const old=db.prepare('SELECT * FROM commerce_reversals WHERE event_key=?').get(eventKey);
   if(old){if(old.order_reference!==reference||old.kind!==kind||old.transaction_id!==transactionId)throw error('IDEMPOTENCY_CONFLICT',409);return {replayed:true};}
   if(transactionId!==null&&!db.prepare('SELECT 1 FROM commerce_receipts WHERE transaction_id=? AND order_reference=?').get(transactionId,reference))throw error('INVALID_TRANSACTION',422);
   db.prepare('INSERT INTO commerce_reversals VALUES(?,?,?,?,?,?)').run(eventKey,reference,kind,transactionId,reason.trim(),new Date().toISOString());
   dispute(reference,'reversal:'+eventKey,kind);compensate(order);
   audit(actor.id,'purchase.'+kind,reference,{eventKey});return {replayed:false};
  });
 }
 function receiveWebhook(raw,header,secrets){
  requireSandbox();
  const event=decodeVerifiedPaystackWebhookV1(raw,header,secrets);
  if(event.event!=='charge.success')return {ignored:true};
  const {reference,id,domain}=event.data;
  if(domain!=='test'||typeof reference!=='string'||!['string','number'].includes(typeof id)||!String(id).trim())throw error('INVALID_EVENT',422);
  const key='charge.success:'+String(id),digest=createHash('sha256').update(raw).digest('hex');
  return transaction(()=>{
   if(!db.prepare('SELECT 1 FROM purchase_orders WHERE reference=?').get(reference))throw error('ORDER_NOT_FOUND',404);
   const old=db.prepare('SELECT * FROM payment_inbox WHERE event_key=?').get(key);
   if(old){if(old.order_reference!==reference)throw error('EVENT_CONFLICT',409);return {eventKey:key,replayed:true};}
   db.prepare('INSERT INTO payment_inbox(event_key,order_reference,transaction_id,payload_sha256,received_at) VALUES(?,?,?,?,?)').run(key,reference,String(id),digest,new Date().toISOString());
   return {eventKey:key,replayed:false};
  });
 }
 async function drainInbox(gateway,{limit=25}={}){
  requireSandbox();
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw error('INVALID_LIMIT',422);
  const results=[];
  for(const event of db.prepare("SELECT * FROM payment_inbox WHERE state<>'processed' AND next_retry_at<=? ORDER BY received_at LIMIT ?").all(Date.now(),limit)){
   db.prepare('UPDATE payment_inbox SET attempts=attempts+1 WHERE event_key=?').run(event.event_key);
   try{
    if(!db.prepare('SELECT 1 FROM commerce_receipts WHERE transaction_id=? AND order_reference=?').get(event.transaction_id,event.order_reference))await reconcileReference(event.order_reference,gateway,event.transaction_id);
    db.prepare("UPDATE payment_inbox SET state='processed',last_error_code=NULL WHERE event_key=?").run(event.event_key);
    results.push({eventKey:event.event_key,state:'processed'});
   }catch(e){
    const code=typeof e.code==='string'&&/^[A-Z_]{1,60}$/.test(e.code)?e.code:'VERIFICATION_FAILED';
    db.prepare("UPDATE payment_inbox SET state='failed',last_error_code=?,next_retry_at=? WHERE event_key=? AND state<>'processed'").run(code,Date.now()+Math.min(3600000,1000*2**Math.min(event.attempts,12)),event.event_key);
    results.push({eventKey:event.event_key,state:'failed',code});
   }
  }
  return results;
 }
 async function recoverPending(gateway,{limit=25}={}){
  requireSandbox();
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw error('INVALID_LIMIT',422);
  const results=[];
  for(let i=0;i<limit;i++){
   const row=transaction(()=>{
    const selected=db.prepare("SELECT o.reference,COALESCE(r.attempts,0) attempts FROM purchase_orders o LEFT JOIN payment_recovery r ON r.order_reference=o.reference WHERE o.status='pending' AND COALESCE(r.next_retry_at,0)<=? ORDER BY COALESCE(r.attempts,0),COALESCE(r.last_attempt_at,0),o.created_at,o.reference LIMIT 1").get(Date.now());
    if(!selected)return null;
    db.prepare('INSERT INTO payment_recovery VALUES(?,1,?,?) ON CONFLICT(order_reference) DO UPDATE SET attempts=attempts+1,last_attempt_at=excluded.last_attempt_at,next_retry_at=excluded.next_retry_at').run(selected.reference,Date.now(),Date.now()+Math.min(3600000,1000*2**Math.min(selected.attempts,12)));
    return selected;
   });
   if(!row)break;
   try{const order=await reconcileReference(row.reference,gateway);results.push({state:order.status});}
   catch(e){results.push({state:'pending',code:typeof e.code==='string'&&/^[A-Z_]{1,60}$/.test(e.code)?e.code:'VERIFICATION_FAILED'});}
  }
  return results;
 }
 function reconciliation(actor){
  requireFinance(actor);
  const sums=db.prepare("SELECT COALESCE(SUM(debit_kobo),0) debit,COALESCE(SUM(credit_kobo),0) credit FROM commerce_lines").get();
  const balance=account=>db.prepare('SELECT COALESCE(SUM(credit_kobo-debit_kobo),0) n FROM commerce_lines WHERE account=?').get(account).n;
  const gross=db.prepare('SELECT COALESCE(SUM(amount_kobo),0) n FROM commerce_receipts').get().n;
  const reversed=db.prepare("SELECT COALESCE(SUM(credit_kobo),0) n FROM commerce_lines l JOIN commerce_events e USING(event_key) WHERE e.kind='reversal' AND l.account='processor_clearing'").get().n;
  const unposted=db.prepare("SELECT count(*) n FROM commerce_events WHERE state<>'posted'").get().n;
  const invalidEvents=db.prepare("SELECT count(*) n FROM commerce_events e WHERE (SELECT count(*) FROM commerce_lines l WHERE l.event_key=e.event_key)<2 OR (SELECT sum(debit_kobo)-sum(credit_kobo) FROM commerce_lines l WHERE l.event_key=e.event_key)<>0").get().n;
  const missing=db.prepare("SELECT count(*) n FROM commerce_receipts r WHERE NOT EXISTS(SELECT 1 FROM commerce_events e WHERE e.event_key='charge:'||r.transaction_id AND e.state='posted' AND e.order_reference=r.order_reference)").get().n;
  const mismatched=db.prepare("SELECT count(*) n FROM commerce_receipts r WHERE COALESCE((SELECT sum(l.debit_kobo) FROM commerce_lines l WHERE l.event_key='charge:'||r.transaction_id AND l.account='processor_clearing'),0)<>r.amount_kobo").get().n;
  return {currency:'NGN',balanced:sums.debit===sums.credit&&unposted===0&&missing===0&&mismatched===0&&invalidEvents===0,debitKobo:sums.debit,creditKobo:sums.credit,grossKobo:gross,reversedKobo:reversed,creatorPendingKobo:balance('creator_payable'),duplicateLiabilityKobo:balance('duplicate_payable'),providerFeeKobo:-balance('provider_fee_suspense'),platformFeeKobo:balance('platform_fee'),settlementAdjustmentKobo:balance('settlement_adjustment'),payoutEnabled:false};
 }
 function recordRestrictedPurchases(creatorId,buyerId){
  for(const order of db.prepare("SELECT reference FROM purchase_orders WHERE creator_id=? AND buyer_id=? AND status='paid'").all(creatorId,buyerId)){
   restrictionDispute(order.reference);
   audit(creatorId,'purchase.access.review_required',order.reference);
  }
 }
 function disputes(actor){
  if(!actor)throw error('AUTH_REQUIRED',401);
  return db.prepare("SELECT d.case_key AS caseKey,d.order_reference AS reference,d.kind,d.status,d.resolution,d.created_at AS createdAt FROM payment_disputes d JOIN purchase_orders o ON o.reference=d.order_reference WHERE o.buyer_id=? ORDER BY d.created_at").all(actor.id);
 }
 function resolveDispute(actor,key,resolution){
  requireFinance(actor);
  if(typeof resolution!=='string'||resolution.trim().length<10||resolution.length>500)throw error('INVALID_RESOLUTION',422);
  return transaction(()=>{
   const row=db.prepare('SELECT * FROM payment_disputes WHERE case_key=?').get(key);if(!row)throw error('DISPUTE_NOT_FOUND',404);
   if(row.status==='resolved')return {replayed:true};
   db.prepare("UPDATE payment_disputes SET status='resolved',resolution=?,resolved_at=? WHERE case_key=?").run(resolution.trim(),new Date().toISOString(),key);
   audit(actor.id,'purchase.dispute.resolved',row.order_reference,{caseKey:key});return {replayed:false};
  });
 }
 return Object.freeze({price,setPrice,requireAccess,createOrder,applyVerifiedTestCharge:testVerification,applySyntheticRefund,ownOrders,creatorEarnings,lessonAccess,orderStatus,sandboxCheckout,confirmSandboxOrder,reconcilePurchase,simulateReversal,receiveWebhook,drainInbox,recoverPending,reconciliation,recordRestrictedPurchases,disputes,resolveDispute});
}
