/** Buyer-scoped receipt projection from existing immutable local accounting.
 * Receipts are sandbox evidence, never proof of real payment or tax invoices.
 * Callers MUST authenticate the current session and verify the student first.
 */
export function readPurchaseReceipt(db,buyerId,reference,error){
 const order=db.prepare('SELECT reference,lesson_id,amount_kobo,currency,environment,paid_at,payment_state FROM purchase_orders WHERE buyer_id=? AND reference=?').get(buyerId,reference);
 if(!order)throw error('ORDER_NOT_FOUND',404);
 if(order.environment!=='test'||order.currency!=='NGN')throw error('RECEIPT_UNAVAILABLE',409);
 const rows=db.prepare('SELECT transaction_id,amount_kobo,created_at FROM commerce_receipts WHERE order_reference=? AND duplicate=0 LIMIT 2').all(reference);
 if(!rows.length)throw error('RECEIPT_UNAVAILABLE',409);
 if(rows.length!==1||rows[0].amount_kobo!==order.amount_kobo||!Number.isSafeInteger(order.amount_kobo)||order.amount_kobo<20000||!order.paid_at)throw error('RECEIPT_INTEGRITY_ERROR',503);
 const row=rows[0];
 const check=db.prepare(`SELECT e.state,e.order_reference,e.kind,COUNT(l.line_no) AS line_count,COALESCE(SUM(l.debit_kobo),0) AS debit,COALESCE(SUM(l.credit_kobo),0) AS credit,COALESCE(SUM(CASE WHEN l.account='processor_clearing' THEN l.debit_kobo ELSE 0 END),0) AS clearing FROM commerce_events e LEFT JOIN commerce_lines l ON l.event_key=e.event_key WHERE e.event_key=? GROUP BY e.event_key`).get('charge:'+row.transaction_id);
 if(!check||check.state!=='posted'||check.kind!=='charge'||check.order_reference!==reference||check.line_count<2||check.debit!==order.amount_kobo||check.credit!==order.amount_kobo||check.clearing!==order.amount_kobo)throw error('RECEIPT_INTEGRITY_ERROR',503);
 const reversals=db.prepare('SELECT kind,created_at FROM commerce_reversals WHERE order_reference=? AND (transaction_id=? OR transaction_id IS NULL) ORDER BY created_at,event_key').all(reference,row.transaction_id);
 const reversed=reversals.length>0;
 if((reversed&&!['refunded','chargeback'].includes(order.payment_state))||(!reversed&&order.payment_state!=='paid'))throw error('RECEIPT_INTEGRITY_ERROR',503);
 if(reversed){
  const r=db.prepare(`SELECT e.state,e.order_reference,e.kind,COUNT(l.line_no) AS line_count,COALESCE(SUM(l.debit_kobo),0) AS debit,COALESCE(SUM(l.credit_kobo),0) AS credit,COALESCE(SUM(CASE WHEN l.account='processor_clearing' THEN l.credit_kobo ELSE 0 END),0) AS clearing FROM commerce_events e LEFT JOIN commerce_lines l ON l.event_key=e.event_key WHERE e.event_key=? GROUP BY e.event_key`).get('reverse:'+row.transaction_id);
  if(!r||r.state!=='posted'||r.kind!=='reversal'||r.order_reference!==reference||r.line_count<2||r.debit!==order.amount_kobo||r.credit!==order.amount_kobo||r.clearing!==order.amount_kobo)throw error('RECEIPT_INTEGRITY_ERROR',503);
 }
 return Object.freeze({reference:order.reference,lessonId:order.lesson_id,currency:'NGN',environment:'test',amountKobo:order.amount_kobo,recordedAt:row.created_at,paidAt:order.paid_at,status:order.payment_state,reversedKobo:reversed?order.amount_kobo:0,netKobo:reversed?0:order.amount_kobo,realMoneyCollected:false});
}
