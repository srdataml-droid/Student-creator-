/** Local SQLite commerce only. Synthetic settlement is NOT a Paystack callback. */
import {randomBytes} from 'node:crypto';
import {quoteLessonPurchase,validateVerifiedCharge} from '../../payment-core/src/payments.mjs';
export function createLocalCommerce({db,transaction,audit,error,requireVerified,requireCreatorAction}){
 db.exec([
 'CREATE TABLE IF NOT EXISTS lesson_prices(lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,amount_kobo INTEGER NOT NULL CHECK(amount_kobo>=20000));',
 "CREATE TABLE IF NOT EXISTS purchase_orders(reference TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES users(id),creator_id TEXT NOT NULL REFERENCES users(id),lesson_id TEXT NOT NULL REFERENCES lessons(id),buyer_email TEXT NOT NULL,amount_kobo INTEGER NOT NULL CHECK(amount_kobo>=20000),creator_share_kobo INTEGER NOT NULL CHECK(creator_share_kobo>=0),status TEXT NOT NULL CHECK(status IN ('pending','paid')),request_key TEXT NOT NULL,provider_transaction_id TEXT UNIQUE,created_at TEXT NOT NULL,paid_at TEXT,UNIQUE(buyer_id,request_key),UNIQUE(buyer_id,lesson_id));",
 'CREATE TABLE IF NOT EXISTS content_entitlements(buyer_id TEXT NOT NULL REFERENCES users(id),lesson_id TEXT NOT NULL REFERENCES lessons(id),order_reference TEXT NOT NULL UNIQUE REFERENCES purchase_orders(reference),granted_at TEXT NOT NULL,PRIMARY KEY(buyer_id,lesson_id));',
 "CREATE TABLE IF NOT EXISTS commerce_journal(order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),line_no INTEGER NOT NULL,account TEXT NOT NULL CHECK(account IN ('processor_clearing','creator_payable')),debit_kobo INTEGER NOT NULL DEFAULT 0 CHECK(debit_kobo>=0),credit_kobo INTEGER NOT NULL DEFAULT 0 CHECK(credit_kobo>=0),created_at TEXT NOT NULL,PRIMARY KEY(order_reference,line_no),CHECK((debit_kobo>0 AND credit_kobo=0) OR (credit_kobo>0 AND debit_kobo=0)));"
 ].join('\n'));
 const price=id=>db.prepare('SELECT amount_kobo FROM lesson_prices WHERE lesson_id=?').get(id)?.amount_kobo??0;
 const snapshot=r=>({reference:r.reference,lessonId:r.lesson_id,amountKobo:r.amount_kobo,currency:'NGN',status:r.status,creatorShareKobo:r.creator_share_kobo,createdAt:r.created_at,paidAt:r.paid_at});
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
  if(!db.prepare('SELECT 1 FROM content_entitlements WHERE buyer_id=? AND lesson_id=?').get(actor.id,id))throw error('PURCHASE_REQUIRED',402);
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
 /**
  * Test-only direct injection; may receive fabricated verificationResponse.
  * NEVER expose via HTTP, webhook or production callbacks. Real settlement
  * must call the Paystack API with a test key before this state transition.
  */
 function applyTrustedCharge(reference,charge){
  return transaction(()=>{
   const order=db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference);
   if(!order)throw error('ORDER_NOT_FOUND',404);
   if(!charge||charge.reference!==order.reference||charge.amountKobo!==order.amount_kobo||
      charge.currency!=='NGN'||typeof charge.providerTransactionId!=='string'||!charge.providerTransactionId)
      throw error('PAYMENT_CONFLICT',409);
   if(order.status==='paid'){
    if(order.provider_transaction_id!==charge.providerTransactionId)throw error('PAYMENT_CONFLICT',409);
    return {...snapshot(order),replayed:true};
   }
   if(db.prepare('SELECT reference FROM purchase_orders WHERE provider_transaction_id=?').get(charge.providerTransactionId))throw error('PROVIDER_TRANSACTION_REUSED',409);
   const now=new Date().toISOString();
   if(db.prepare("UPDATE purchase_orders SET status='paid',provider_transaction_id=?,paid_at=? WHERE reference=? AND status='pending'").run(charge.providerTransactionId,now,reference).changes!==1)throw error('PAYMENT_CONFLICT',409);
   db.prepare('INSERT INTO content_entitlements(buyer_id,lesson_id,order_reference,granted_at) VALUES(?,?,?,?)').run(order.buyer_id,order.lesson_id,reference,now);
   db.prepare('INSERT INTO commerce_journal(order_reference,line_no,account,debit_kobo,credit_kobo,created_at) VALUES(?,?,?,?,?,?)').run(reference,1,'processor_clearing',order.amount_kobo,0,now);
   db.prepare('INSERT INTO commerce_journal(order_reference,line_no,account,debit_kobo,credit_kobo,created_at) VALUES(?,?,?,?,?,?)').run(reference,2,'creator_payable',0,order.creator_share_kobo,now);
   audit(order.buyer_id,'purchase.entitlement.granted',reference,{lessonId:order.lesson_id});
   return {...snapshot(db.prepare('SELECT * FROM purchase_orders WHERE reference=?').get(reference)),replayed:false};
  });
 }
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
  const row=trustedOrder(actor,reference);
  if(row.status!=='pending')throw error('ALREADY_PURCHASED',409);
  requireCreatorAction(actor,row.creator_id,'view');
  if(!gateway||typeof gateway.initialize!=='function')throw error('SANDBOX_PAYMENTS_UNAVAILABLE',503);
  return gateway.initialize({reference:row.reference,buyerEmail:row.buyer_email,amountKobo:row.amount_kobo,domain:'test'});
 }
 async function confirmSandboxOrder(actor,reference,gateway){
  const row=trustedOrder(actor,reference);
  if(row.status==='paid')return {...snapshot(row),replayed:true};
  if(!gateway||typeof gateway.verify!=='function')throw error('SANDBOX_PAYMENTS_UNAVAILABLE',503);
  // The adapter performs Paystack server-to-server verification of order,
  // amount, currency, customer and test domain. Never trust the browser callback.
  const verified=await gateway.verify({reference:row.reference,buyerEmail:row.buyer_email,amountKobo:row.amount_kobo,domain:'test'});
  return applyTrustedCharge(reference,verified);
 }
 function ownOrders(actor){requireVerified(actor);return db.prepare('SELECT * FROM purchase_orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100').all(actor.id).map(snapshot);}
 function creatorEarnings(actor){
  requireVerified(actor);
  const r=db.prepare("SELECT COALESCE(SUM(creator_share_kobo),0) AS pending,COUNT(*) AS count FROM purchase_orders WHERE creator_id=? AND status='paid'").get(actor.id);
  return {currency:'NGN',creatorPendingKobo:r.pending,paidOrders:r.count,payoutEnabled:false,commissionApproved:false};
 }
 function lessonAccess(actor,id){
  requireVerified(actor);
  const l=published(id);if(!l||l.status!=='published'||!l.active)throw error('LESSON_NOT_FOUND',404);
  requireCreatorAction(actor,l.creator_id,'view');
  const amountKobo=price(id),owned=actor.id===l.creator_id;
  return {lessonId:id,priceKobo:amountKobo,currency:'NGN',
   entitled:owned||!amountKobo||Boolean(db.prepare('SELECT 1 FROM content_entitlements WHERE buyer_id=? AND lesson_id=?').get(actor.id,id)),
   creatorOwned:owned,checkoutEnabled:false};
 }
 return Object.freeze({price,setPrice,requireAccess,createOrder,applyVerifiedTestCharge:testVerification,ownOrders,creatorEarnings,lessonAccess,orderStatus,sandboxCheckout,confirmSandboxOrder});
}
