/** Canonical posted financial journal; order rows supply ownership, not money. */
export function readCreatorJournal(db, creatorId) {
  return db.prepare(`
    SELECT COALESCE(SUM(net), 0) AS pending,
           COALESCE(SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END), 0) AS count
    FROM (
      SELECT e.order_reference, SUM(l.credit_kobo - l.debit_kobo) AS net
      FROM commerce_lines l
      JOIN commerce_events e ON e.event_key = l.event_key
      JOIN purchase_orders o ON o.reference = e.order_reference
      WHERE o.creator_id = ? AND e.state = 'posted' AND l.account = 'creator_payable'
      GROUP BY e.order_reference
    )
  `).get(creatorId);
}
