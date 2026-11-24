/** Week 6 sandbox-only payment snapshots for class/service entitlements.
 * Reuses Week 5 Paystack test verification and commission=0 signed ledger principles.
 * NO automatic refunds, real PSP charges, creator withdrawals or production settlement.
 */
import {randomBytes} from 'node:crypto';
import {quoteLessonPurchase} from '../../payment-core/src/payments.mjs';
import {decodeVerifiedPaystackWebhookV1} from '../../payment-core/src/webhooks.mjs';

const KEY=/^[A-Za-z0-9_-]{16,128}$/;
const stamp=()=>new Date().toISOString();
const status=r=>({
  reference:r.reference,resourceKind:r.resource_kind,resourceId:r.resource_id,
  amountKobo:r.amount_kobo,currency:'NGN',status:r.state,
  createdAt:r.created_at,paidAt:r.paid_at,environment:'test',
  refundedAt:r.refunded_at
});
function validCheckout(url){
  try{
    const x=new URL(url);
    if(x.protocol!=='https:'||!['checkout.paystack.com','paystack.com'].includes(x.hostname)||
       x.username||x.password||x.port||x.hash) return null;
    return x.toString();
  }catch{return null;}
}
export function createLearningPayments({db,transaction,audit,error,requireVerified,requireCreatorAction}){
  db.exec([
    "CREATE TABLE IF NOT EXISTS learning_purchase_orders (reference TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES users(id),creator_id TEXT NOT NULL REFERENCES users(id),buyer_email TEXT NOT NULL,resource_kind TEXT NOT NULL CHECK(resource_kind IN ('class','service')),resource_id TEXT NOT NULL,amount_kobo INTEGER NOT NULL CHECK(amount_kobo>=20000),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','paid_review','refunded','chargeback')),provider_transaction_id TEXT UNIQUE,provider_fee_kobo INTEGER NOT NULL DEFAULT 0,request_key TEXT NOT NULL,created_at TEXT NOT NULL,paid_at TEXT,refunded_at TEXT,UNIQUE(buyer_id,request_key),UNIQUE(buyer_id,resource_kind,resource_id));",
    "CREATE TABLE IF NOT EXISTS learning_payment_entitlements(buyer_id TEXT NOT NULL REFERENCES users(id),resource_kind TEXT NOT NULL CHECK(resource_kind IN ('class','service')),resource_id TEXT NOT NULL,order_reference TEXT NOT NULL UNIQUE REFERENCES learning_purchase_orders(reference),state TEXT NOT NULL CHECK(state IN ('active','revoked')),granted_at TEXT NOT NULL,revoked_at TEXT,PRIMARY KEY(buyer_id,resource_kind,resource_id));",
    "CREATE TABLE IF NOT EXISTS learning_checkout_sessions(order_reference TEXT PRIMARY KEY REFERENCES learning_purchase_orders(reference),state TEXT NOT NULL CHECK(state IN ('started','ready','uncertain')),authorization_url TEXT,updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS learning_payment_events(order_reference TEXT NOT NULL REFERENCES learning_purchase_orders(reference),event_key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('charge','provider_fee','refund','chargeback')),created_at TEXT NOT NULL,PRIMARY KEY(order_reference,event_key));",
    "CREATE TABLE IF NOT EXISTS learning_payment_ledger(order_reference TEXT NOT NULL,event_key TEXT NOT NULL,line_no INTEGER NOT NULL,account TEXT NOT NULL CHECK(account IN ('processor_clearing','creator_payable','provider_fee_suspense')),debit_kobo INTEGER NOT NULL DEFAULT 0 CHECK(debit_kobo>=0),credit_kobo INTEGER NOT NULL DEFAULT 0 CHECK(credit_kobo>=0),created_at TEXT NOT NULL,PRIMARY KEY(order_reference,event_key,line_no),FOREIGN KEY(order_reference,event_key) REFERENCES learning_payment_events(order_reference,event_key),CHECK((debit_kobo>0 AND credit_kobo=0) OR (credit_kobo>0 AND debit_kobo=0)));",
    "CREATE TABLE IF NOT EXISTS learning_payment_inbox(event_key TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES learning_purchase_orders(reference),transaction_id TEXT NOT NULL,raw_sha256 TEXT NOT NULL,received_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','processing','processed','failed')),lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,last_error_code TEXT);"
  ].join('\n'));
  function requireTest(gateway){
    if(process.env.NODE_ENV==='production')throw error('SANDBOX_PAYMENTS_DISABLED',403);
    if(gateway?.environment!=='test'||typeof gateway.verify!=='function')
      throw error('SANDBOX_PAYMENTS_UNAVAILABLE',503);
  }
  function requireOrder(actor,reference){
    requireVerified(actor);
    const r=db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=? AND buyer_id=?').get(reference,actor.id);
    if(!r)throw error('ORDER_NOT_FOUND',404);
    return r;
  }
  function requireAdmin(actor){
    if(!actor||actor.role!=='admin'||actor.suspended||
       !db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND suspended=0").get(actor.id))
      throw error('ADMIN_REQUIRED',403);
  }
  function orderInput(actor,resourceKind,resourceId){
    if(!['class','service'].includes(resourceKind)||typeof resourceId!=='string')
      throw error('INVALID_RESOURCE',422);
    if(resourceKind==='class'){
      const row=db.prepare('SELECT c.*,cs.institution_id AS institutionId FROM interactive_classes c JOIN courses cs ON cs.id=c.course_id WHERE c.id=?').get(resourceId);
      if(!row||row.institutionId!==actor.institutionId)throw error('CLASS_NOT_FOUND',404);
      requireCreatorAction(actor,row.host_id,'view');
      if(row.host_id===actor.id)throw error('SELF_PURCHASE_FORBIDDEN',403);
      if(!db.prepare("SELECT 1 FROM interactive_class_enrollments WHERE class_id=? AND student_id=? AND status='enrolled'").get(resourceId,actor.id))
        throw error('NOT_ENROLLED',403);
      if(!['scheduled','room_open'].includes(row.status)||Date.parse(row.ends_at)<Date.now())throw error('CLASS_CLOSED',409);
      return {creatorId:row.host_id,amountKobo:row.price_kobo};
    }
    const row=db.prepare('SELECT * FROM learning_requests WHERE id=? AND student_id=?').get(resourceId,actor.id);
    if(!row)throw error('REQUEST_NOT_FOUND',404);
    requireCreatorAction(actor,row.creator_id,'message');
    if(!['accepted','in_progress'].includes(row.status))throw error('HELP_CLOSED',409);
    return {creatorId:row.creator_id,amountKobo:row.quote_kobo};
  }
  function createOrder(actor,resourceKind,resourceId,requestKey){
    requireVerified(actor);
    if(typeof requestKey!=='string'||!KEY.test(requestKey))throw error('INVALID_IDEMPOTENCY_KEY',422);
    return transaction(()=>{
      const previous=db.prepare('SELECT * FROM learning_purchase_orders WHERE buyer_id=? AND request_key=?').get(actor.id,requestKey);
      if(previous){
        if(previous.resource_kind!==resourceKind||previous.resource_id!==resourceId)throw error('IDEMPOTENCY_CONFLICT',409);
        return {...status(previous),replayed:true};
      }
      const existing=db.prepare('SELECT * FROM learning_purchase_orders WHERE buyer_id=? AND resource_kind=? AND resource_id=?').get(actor.id,resourceKind,resourceId);
      if(existing)return {...status(existing),replayed:true};
      const {creatorId,amountKobo}=orderInput(actor,resourceKind,resourceId);
      if(!Number.isSafeInteger(amountKobo)||amountKobo<20000)throw error('FREE_OR_UNPRICED_RESOURCE',409);
      quoteLessonPurchase(amountKobo,0); // Week 5 validated integer limits; NO founder commission invented.
      const buyer=db.prepare('SELECT email FROM users WHERE id=?').get(actor.id);
      if(!buyer)throw error('AUTH_REQUIRED',401);
      const reference='lsc_'+randomBytes(18).toString('hex');
      db.prepare("INSERT INTO learning_purchase_orders(reference,buyer_id,creator_id,buyer_email,resource_kind,resource_id,amount_kobo,state,request_key,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)")
       .run(reference,actor.id,creatorId,buyer.email,resourceKind,resourceId,amountKobo,requestKey,stamp());
      audit(actor.id,'learning.order.created',reference,{resourceKind,resourceId});
      return {...status(db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=?').get(reference)),replayed:false};
    });
  }
  function hasActiveEntitlement({buyerId,resourceKind,resourceId}={}){
    if(typeof buyerId!=='string'||!['class','service'].includes(resourceKind)||typeof resourceId!=='string')return false;
    return Boolean(db.prepare("SELECT 1 FROM learning_payment_entitlements e JOIN learning_purchase_orders o ON o.reference=e.order_reference WHERE e.buyer_id=? AND e.resource_kind=? AND e.resource_id=? AND e.state='active' AND o.state='paid' AND o.buyer_id=e.buyer_id AND o.resource_kind=e.resource_kind AND o.resource_id=e.resource_id").get(buyerId,resourceKind,resourceId));
  }
  async function checkout(actor,reference,gateway){
    requireTest(gateway);
    if(typeof gateway.initialize!=='function')throw error('SANDBOX_PAYMENTS_UNAVAILABLE',503);
    const row=requireOrder(actor,reference);
    if(row.state!=='pending')throw error('ALREADY_PURCHASED',409);
    // Prevent checkout for canceled classes or rejected tutoring services.
    orderInput(actor,row.resource_kind,row.resource_id);
    const claimed=db.prepare("INSERT INTO learning_checkout_sessions(order_reference,state,updated_at) VALUES(?,'started',?) ON CONFLICT(order_reference) DO NOTHING")
      .run(reference,stamp()).changes;
    if(!claimed){
      const prior=db.prepare('SELECT state,authorization_url FROM learning_checkout_sessions WHERE order_reference=?').get(reference);
      const safe=validCheckout(prior?.authorization_url);
      if(prior?.state==='ready'&&safe)return {reference,authorizationUrl:safe,replayed:true};
      throw error('CHECKOUT_INITIALIZATION_UNCERTAIN',409);
    }
    try{
      const payment=await gateway.initialize({reference,buyerEmail:row.buyer_email,amountKobo:row.amount_kobo,domain:'test'});
      const url=validCheckout(payment?.authorizationUrl);
      if(!url||payment.reference!==reference)throw error('INVALID_CHECKOUT_RESPONSE',502);
      db.prepare("UPDATE learning_checkout_sessions SET state='ready',authorization_url=?,updated_at=? WHERE order_reference=? AND state='started'").run(url,stamp(),reference);
      return {reference,authorizationUrl:url,replayed:false};
    }catch(cause){
      db.prepare("UPDATE learning_checkout_sessions SET state='uncertain',updated_at=? WHERE order_reference=? AND state='started'").run(stamp(),reference);
      throw cause;
    }
  }
  function post(reference,eventKey,kind,lines){
    if(db.prepare('SELECT 1 FROM learning_payment_events WHERE order_reference=? AND event_key=?').get(reference,eventKey))return false;
    const debit=lines.reduce((sum,l)=>sum+l[1],0),credit=lines.reduce((sum,l)=>sum+l[2],0);
    if(debit!==credit||debit<=0)throw error('UNBALANCED_JOURNAL',500);
    db.prepare('INSERT INTO learning_payment_events VALUES(?,?,?,?)').run(reference,eventKey,kind,stamp());
    let i=0;for(const [account,d,c] of lines)if(d||c)
      db.prepare('INSERT INTO learning_payment_ledger VALUES(?,?,?,?,?,?,?)').run(reference,eventKey,++i,account,d,c,stamp());
    return true;
  }
  function applyVerifiedCharge(reference,charge){
    return transaction(()=>{
      const r=db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=?').get(reference);
      if(!r)throw error('ORDER_NOT_FOUND',404);
      if(charge?.reference!==reference||charge.currency!=='NGN'||charge.domain!=='test'||
         charge.amountKobo!==r.amount_kobo||typeof charge.providerTransactionId!=='string'||
         !charge.providerTransactionId||!Number.isSafeInteger(charge.providerFeeKobo)||charge.providerFeeKobo<0||
         charge.providerFeeKobo>r.amount_kobo)throw error('PAYMENT_VERIFICATION_FAILED',409);
      // One provider transaction cannot fund a different learning order or a paid lesson.
      const other=db.prepare('SELECT reference FROM learning_purchase_orders WHERE provider_transaction_id=?').get(charge.providerTransactionId);
      if(other&&other.reference!==reference)throw error('PROVIDER_TRANSACTION_REUSED',409);
      if(db.prepare('SELECT 1 FROM commerce_receipts WHERE transaction_id=?').get(charge.providerTransactionId))
        throw error('PROVIDER_TRANSACTION_REUSED',409);
      if(['paid','paid_review'].includes(r.state)){
        if(r.provider_transaction_id!==charge.providerTransactionId)throw error('PAYMENT_CONFLICT',409);
        return {...status(r),replayed:true};
      }
      if(r.state!=='pending')throw error('PAYMENT_REVERSED',409);
      // If a provider charge arrives after class/service cancellation, it must
      // enter financial review; never mint an entitlement for a closed resource.
      let closed=false;
      if(r.resource_kind==='class'){
        const cls=db.prepare('SELECT status,ends_at FROM interactive_classes WHERE id=?').get(r.resource_id);
        closed=!cls||!['scheduled','room_open'].includes(cls.status)||Date.parse(cls.ends_at)<Date.now();
      }else{
        const task=db.prepare('SELECT status FROM learning_requests WHERE id=?').get(r.resource_id);
        closed=!task||!['accepted','in_progress'].includes(task.status);
      }
      if(closed){
        const at=stamp();
        db.prepare("UPDATE learning_purchase_orders SET state='paid_review',provider_transaction_id=?,provider_fee_kobo=?,paid_at=? WHERE reference=? AND state='pending'")
          .run(charge.providerTransactionId,charge.providerFeeKobo,at,reference);
        post(reference,'charge:'+charge.providerTransactionId,'charge',[
          ['processor_clearing',r.amount_kobo,0],['creator_payable',0,r.amount_kobo]]);
        if(charge.providerFeeKobo)post(reference,'fee:'+charge.providerTransactionId,'provider_fee',[
          ['provider_fee_suspense',charge.providerFeeKobo,0],['processor_clearing',0,charge.providerFeeKobo]]);
        db.prepare('INSERT OR IGNORE INTO learning_refund_reviews(id,resource_kind,resource_id,student_id,reason,created_at) VALUES(?,?,?,?,?,?)')
          .run('late-payment:'+reference,r.resource_kind,r.resource_id,r.buyer_id,'Verified provider payment received after the service was closed; refund verification required.',at);
        audit(r.buyer_id,'learning.order.charge_after_closure',reference);
        return {...status(db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=?').get(reference)),
          requiresRefundReview:true,replayed:false};
      }
      const at=stamp();
      const changed=db.prepare("UPDATE learning_purchase_orders SET state='paid',provider_transaction_id=?,provider_fee_kobo=?,paid_at=? WHERE reference=? AND state='pending'")
        .run(charge.providerTransactionId,charge.providerFeeKobo,at,reference).changes;
      if(!changed)throw error('PAYMENT_CONFLICT',409);
      db.prepare("INSERT INTO learning_payment_entitlements(buyer_id,resource_kind,resource_id,order_reference,state,granted_at) VALUES(?,?,?,?,'active',?)")
        .run(r.buyer_id,r.resource_kind,r.resource_id,reference,at);
      post(reference,'charge:'+charge.providerTransactionId,'charge',[
        ['processor_clearing',r.amount_kobo,0],['creator_payable',0,r.amount_kobo]]);
      if(charge.providerFeeKobo)post(reference,'fee:'+charge.providerTransactionId,'provider_fee',[
        ['provider_fee_suspense',charge.providerFeeKobo,0],['processor_clearing',0,charge.providerFeeKobo]]);
      audit(r.buyer_id,'learning.order.verified_paid',reference,{resourceKind:r.resource_kind,resourceId:r.resource_id});
      return {...status(db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=?').get(reference)),replayed:false};
    });
  }
  async function confirm(actor,reference,gateway){
    requireTest(gateway);
    const row=requireOrder(actor,reference);
    // Test-mode real provider verification, NOT a browser callback proof.
    const charge=await gateway.verify({reference,buyerEmail:row.buyer_email,amountKobo:row.amount_kobo,domain:'test'});
    return applyVerifiedCharge(reference,charge);
  }
  function reversal(actor,reference,{kind,reason,key}={}){
    if(process.env.NODE_ENV==='production')throw error('TEST_REFUND_DISABLED',403);
    requireAdmin(actor);
    if(!['refund','chargeback'].includes(kind)||typeof reason!=='string'||reason.trim().length<10||
       reason.trim().length>500||!KEY.test(key??''))throw error('INVALID_REVERSAL',422);
    return transaction(()=>{
      const r=db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=?').get(reference);
      if(!r)throw error('ORDER_NOT_FOUND',404);
      const targetState=kind==='refund'?'refunded':'chargeback';
      if(r.state===targetState)return {...status(r),replayed:true};
      if(!['paid','paid_review'].includes(r.state))throw error('PAYMENT_CONFLICT',409);
      post(reference,'reverse:'+key,kind,[
        ['creator_payable',r.amount_kobo,0],['processor_clearing',0,r.amount_kobo]]);
      db.prepare('UPDATE learning_purchase_orders SET state=?,refunded_at=? WHERE reference=?')
        .run(kind==='refund'?'refunded':'chargeback',stamp(),reference);
      db.prepare("UPDATE learning_payment_entitlements SET state='revoked',revoked_at=? WHERE order_reference=?")
        .run(stamp(),reference);
      audit(actor.id,'learning.order.'+kind,reference,{reason:reason.trim()});
      return {...status(db.prepare('SELECT * FROM learning_purchase_orders WHERE reference=?').get(reference)),replayed:false};
    });
  }
  function ownOrders(actor){
    requireVerified(actor);
    return db.prepare('SELECT * FROM learning_purchase_orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100').all(actor.id).map(status);
  }
  function checkLedger(actor,reference){
    requireAdmin(actor);
    const lines=db.prepare('SELECT event_key,kind,account,debit_kobo AS debitKobo,credit_kobo AS creditKobo FROM learning_payment_ledger l JOIN learning_payment_events e USING(order_reference,event_key) WHERE l.order_reference=? ORDER BY l.event_key,l.line_no').all(reference);
    const eventTotals=new Map();
    for(const line of lines){const t=eventTotals.get(line.event_key)??{debit:0,credit:0};t.debit+=line.debitKobo;t.credit+=line.creditKobo;eventTotals.set(line.event_key,t);}
    return {reference,events:[...eventTotals].map(([eventKey,t])=>({eventKey,...t,balanced:t.debit===t.credit})),payoutEnabled:false};
  }
  return {createLearningOrder:createOrder,hasActiveEntitlement,
    learningOrder:(actor,ref)=>status(requireOrder(actor,ref)),
    myLearningOrders:ownOrders,learningCheckout:checkout,learningConfirm:confirm,
    applyVerifiedLearningCharge:applyVerifiedCharge,simulateLearningReversal:reversal,learningLedger:checkLedger};
}
