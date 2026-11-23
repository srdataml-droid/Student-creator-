/** Additive, transactional local migrations. PostgreSQL draft is not the runtime. */
export function migrateCommerce(db,transaction){
 transaction(()=>{
  const columns=new Set(db.prepare('PRAGMA table_info(purchase_orders)').all().map(r=>r.name));
  for(const [name,definition] of Object.entries({currency:"TEXT NOT NULL DEFAULT 'NGN' CHECK(currency='NGN')",environment:"TEXT NOT NULL DEFAULT 'test' CHECK(environment='test')",platform_fee_bps:'INTEGER NOT NULL DEFAULT 0 CHECK(platform_fee_bps=0)',terms_version:"TEXT NOT NULL DEFAULT 'synthetic-v1'",payment_state:"TEXT NOT NULL DEFAULT 'pending' CHECK(payment_state IN ('pending','paid','refunded','chargeback'))",fee_policy:"TEXT NOT NULL DEFAULT 'unapproved-no-commission'"})){
   if(!columns.has(name))db.exec(`ALTER TABLE purchase_orders ADD COLUMN ${name} ${definition}`);
  }
  db.exec("UPDATE purchase_orders SET payment_state='paid' WHERE status='paid' AND payment_state='pending'");
  if(!db.prepare('PRAGMA table_info(content_entitlements)').all().some(r=>r.name==='state'))db.exec("ALTER TABLE content_entitlements ADD COLUMN state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked','suspended'))");
  db.exec(`
   CREATE TRIGGER IF NOT EXISTS immutable_order BEFORE UPDATE OF reference,buyer_id,creator_id,lesson_id,buyer_email,amount_kobo,creator_share_kobo,request_key,created_at,currency,environment,platform_fee_bps,terms_version,fee_policy ON purchase_orders
   BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER'); END;
   CREATE TABLE IF NOT EXISTS commerce_receipts(transaction_id TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),amount_kobo INTEGER NOT NULL CHECK(amount_kobo>=20000),provider_fee_kobo INTEGER NOT NULL CHECK(provider_fee_kobo>=0),duplicate INTEGER NOT NULL CHECK(duplicate IN (0,1)),created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS commerce_events(event_key TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','posted')),created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS commerce_lines(event_key TEXT NOT NULL REFERENCES commerce_events(event_key),line_no INTEGER NOT NULL,account TEXT NOT NULL CHECK(account IN ('processor_clearing','creator_payable','duplicate_payable','platform_fee','provider_fee_suspense','settlement_adjustment')),debit_kobo INTEGER NOT NULL CHECK(debit_kobo>=0),credit_kobo INTEGER NOT NULL CHECK(credit_kobo>=0),PRIMARY KEY(event_key,line_no),CHECK((debit_kobo>0 AND credit_kobo=0) OR (credit_kobo>0 AND debit_kobo=0)));
   CREATE TRIGGER IF NOT EXISTS entitlement_matches_order BEFORE INSERT ON content_entitlements
   BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM purchase_orders o JOIN commerce_receipts r ON r.order_reference=o.reference AND r.duplicate=0 WHERE o.reference=NEW.order_reference AND o.buyer_id=NEW.buyer_id AND o.lesson_id=NEW.lesson_id AND o.status='paid') THEN RAISE(ABORT,'INVALID_ENTITLEMENT') END; END;
   CREATE TRIGGER IF NOT EXISTS entitlement_cannot_reactivate BEFORE UPDATE OF state ON content_entitlements WHEN NEW.state='active' AND EXISTS(SELECT 1 FROM commerce_reversals r JOIN purchase_orders o ON o.reference=r.order_reference WHERE r.order_reference=NEW.order_reference AND (r.transaction_id IS NULL OR r.transaction_id=o.provider_transaction_id))
   BEGIN SELECT RAISE(ABORT,'REVERSED_ENTITLEMENT'); END;
   CREATE TRIGGER IF NOT EXISTS entitlement_identity_immutable BEFORE UPDATE OF buyer_id,lesson_id,order_reference,granted_at ON content_entitlements BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ENTITLEMENT'); END;
   CREATE TRIGGER IF NOT EXISTS event_starts_draft BEFORE INSERT ON commerce_events WHEN NEW.state<>'draft' BEGIN SELECT RAISE(ABORT,'DRAFT_REQUIRED'); END;
   CREATE TRIGGER IF NOT EXISTS balance_event BEFORE UPDATE OF state ON commerce_events WHEN NEW.state='posted'
   BEGIN SELECT CASE WHEN (SELECT count(*) FROM commerce_lines WHERE event_key=NEW.event_key)<2 OR (SELECT sum(debit_kobo)-sum(credit_kobo) FROM commerce_lines WHERE event_key=NEW.event_key)<>0 THEN RAISE(ABORT,'UNBALANCED_JOURNAL') END; END;
   CREATE TRIGGER IF NOT EXISTS sealed_lines BEFORE INSERT ON commerce_lines WHEN (SELECT state FROM commerce_events WHERE event_key=NEW.event_key)='posted' BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
   CREATE TRIGGER IF NOT EXISTS sealed_events BEFORE UPDATE ON commerce_events WHEN OLD.state='posted' BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
   CREATE TABLE IF NOT EXISTS commerce_reversals(event_key TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),kind TEXT NOT NULL CHECK(kind IN ('refund','chargeback')),transaction_id TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS payment_disputes(case_key TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),resolution TEXT,created_at TEXT NOT NULL,resolved_at TEXT);
   CREATE TABLE IF NOT EXISTS payment_recovery(order_reference TEXT PRIMARY KEY REFERENCES purchase_orders(reference),attempts INTEGER NOT NULL DEFAULT 0,last_attempt_at INTEGER NOT NULL DEFAULT 0,next_retry_at INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS payment_inbox(event_key TEXT PRIMARY KEY,order_reference TEXT NOT NULL REFERENCES purchase_orders(reference),transaction_id TEXT NOT NULL,payload_sha256 TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'received' CHECK(state IN ('received','processed','failed')),attempts INTEGER NOT NULL DEFAULT 0,next_retry_at INTEGER NOT NULL DEFAULT 0,last_error_code TEXT,received_at TEXT NOT NULL);
  `);
  for(const table of ['commerce_lines','commerce_receipts','commerce_reversals','commerce_journal','synthetic_refunds'])for(const operation of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;`);
  db.exec("CREATE TRIGGER IF NOT EXISTS immutable_commerce_events_DELETE BEFORE DELETE ON commerce_events BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;");
  // Backfill already paid local orders once, preserving original two-line journal.
  for(const r of db.prepare("SELECT * FROM purchase_orders WHERE status='paid' AND NOT EXISTS(SELECT 1 FROM commerce_receipts p WHERE p.transaction_id=purchase_orders.provider_transaction_id)").all()){
   db.prepare('INSERT INTO commerce_receipts VALUES(?,?,?,?,0,?)').run(r.provider_transaction_id,r.reference,r.amount_kobo,0,r.paid_at);
   const key='charge:'+r.provider_transaction_id;
   db.prepare("INSERT INTO commerce_events VALUES(?,?, 'charge','draft',?)").run(key,r.reference,r.paid_at);
   db.prepare('INSERT INTO commerce_lines SELECT ?,line_no,account,debit_kobo,credit_kobo FROM commerce_journal WHERE order_reference=? AND line_no IN (1,2)').run(key,r.reference);
   db.prepare("UPDATE commerce_events SET state='posted' WHERE event_key=?").run(key);
  }
  // Import the earlier synthetic-refund implementation without deleting history.
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='synthetic_refunds'").get()){
   for(const r of db.prepare('SELECT o.*,f.refund_reference,f.created_at refund_at FROM synthetic_refunds f JOIN purchase_orders o ON o.reference=f.order_reference').all()){
    db.prepare('INSERT OR IGNORE INTO commerce_reversals VALUES(?,?,?,?,?,?)').run('legacy-refund:'+r.refund_reference,r.reference,'refund',r.provider_transaction_id,'Imported synthetic test refund',r.refund_at);
    const key='reverse:'+r.provider_transaction_id;
    if(!db.prepare('SELECT 1 FROM commerce_events WHERE event_key=?').get(key)){
     db.prepare("INSERT INTO commerce_events VALUES(?,?,'reversal','draft',?)").run(key,r.reference,r.refund_at);
     db.prepare('INSERT INTO commerce_lines VALUES(?,?,?,?,?)').run(key,1,'creator_payable',r.creator_share_kobo,0);
     db.prepare('INSERT INTO commerce_lines VALUES(?,?,?,?,?)').run(key,2,'processor_clearing',0,r.amount_kobo);
     db.prepare("UPDATE commerce_events SET state='posted' WHERE event_key=?").run(key);
    }
    db.prepare("UPDATE purchase_orders SET payment_state=CASE WHEN payment_state='chargeback' THEN payment_state ELSE 'refunded' END WHERE reference=?").run(r.reference);
    db.prepare("INSERT OR IGNORE INTO content_entitlements(buyer_id,lesson_id,order_reference,granted_at,state) VALUES(?,?,?,?,'revoked')").run(r.buyer_id,r.lesson_id,r.reference,r.paid_at);
    db.prepare("UPDATE content_entitlements SET state='revoked' WHERE order_reference=?").run(r.reference);
   }
  }
 });
}
