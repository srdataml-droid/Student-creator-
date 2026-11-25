/** Scope to creator-owned orders and canonical, posted creator-payable events.
 * Never include buyer identity, PSP transaction identifiers, or compatibility journal.
 * Call only after current actor eligibility checks; all values represent test accounting.
 */
export function readCreatorFinancialHistory(db,creatorId){
 const rows=db.prepare(`SELECT o.reference,o.lesson_id AS lessonId,e.kind,e.created_at AS recordedAt,SUM(l.credit_kobo-l.debit_kobo) AS deltaKobo
 FROM commerce_lines l JOIN commerce_events e ON e.event_key=l.event_key
 JOIN purchase_orders o ON o.reference=e.order_reference
 WHERE o.creator_id=? AND o.environment='test' AND e.state='posted'
 AND l.account='creator_payable' AND e.kind IN ('charge','reversal')
 GROUP BY e.event_key,o.reference,o.lesson_id,e.kind,e.created_at
 ORDER BY e.created_at DESC,e.event_key DESC LIMIT 100`).all(creatorId);
 return rows.map(row=>({reference:row.reference,lessonId:row.lessonId,kind:row.kind,recordedAt:row.recordedAt,deltaKobo:row.deltaKobo,currency:'NGN',environment:'test',withdrawable:false}));
}
