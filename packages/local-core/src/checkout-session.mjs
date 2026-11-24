/** Durable sandbox checkout initialization. Never grant entitlements here. */
export function migrateCheckoutSessions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS checkout_sessions (
    order_reference TEXT PRIMARY KEY REFERENCES purchase_orders(reference),
    state TEXT NOT NULL CHECK(state IN ('started','ready','uncertain')),
    authorization_url TEXT,
    updated_at TEXT NOT NULL,
    CHECK ((state='ready' AND authorization_url IS NOT NULL) OR (state<>'ready' AND authorization_url IS NULL))
  )`);
}

export async function initializeCheckoutSession(db, order, gateway, error) {
  const reference = order.reference;
  const now = () => new Date().toISOString();
  // This single autocommitted insert claims initialization before network I/O.
  const claimed = db.prepare("INSERT INTO checkout_sessions(order_reference,state,updated_at) VALUES(?,'started',?) ON CONFLICT(order_reference) DO NOTHING").run(reference,now()).changes;
  if (!claimed) {
    const previous = db.prepare('SELECT state,authorization_url FROM checkout_sessions WHERE order_reference=?').get(reference);
    if (previous?.state === 'ready') return {reference,authorizationUrl:previous.authorization_url};
    // A lost response is ambiguous. Verify the stored reference, never create a
    // second checkout automatically. Operator recovery is required if unpaid.
    throw error('CHECKOUT_INITIALIZATION_UNCERTAIN',409);
  }
  try {
    const checkout = await gateway.initialize(order);
    if (checkout?.reference !== reference || typeof checkout.authorizationUrl !== 'string') throw error('INVALID_CHECKOUT_RESPONSE',502);
    let url;
    try { url = new URL(checkout.authorizationUrl); }
    catch { throw error('INVALID_CHECKOUT_RESPONSE',502); }
    if (url.protocol !== 'https:' || !['checkout.paystack.com','paystack.com'].includes(url.hostname) || url.username || url.password || url.port) throw error('INVALID_CHECKOUT_RESPONSE',502);
    db.prepare("UPDATE checkout_sessions SET state='ready',authorization_url=?,updated_at=? WHERE order_reference=? AND state='started'").run(url.toString(),now(),reference);
    return {reference,authorizationUrl:url.toString()};
  } catch (cause) {
    db.prepare("UPDATE checkout_sessions SET state='uncertain',updated_at=? WHERE order_reference=? AND state='started'").run(now(),reference);
    throw cause;
  }
}
