import { randomUUID } from 'node:crypto';

// Operational limits, not a financial policy. The provider timeout is <=30s.
export const INBOX_MAX_ATTEMPTS = 12;
export const INBOX_LEASE_MS = 60_000;
export function migrateInboxLeases(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(payment_inbox)').all().map(r=>r.name));
  for (const [name,definition] of Object.entries({lease_token:'TEXT',lease_until:'INTEGER NOT NULL DEFAULT 0',dead_lettered_at:'INTEGER'})) {
    if (!columns.has(name)) db.exec(`ALTER TABLE payment_inbox ADD COLUMN ${name} ${definition}`);
  }
}

export function claimInboxEvent(db, now = Date.now()) {
  // A worker killed during its final attempt must also become visible for review.
  db.prepare(`UPDATE payment_inbox SET state='failed',last_error_code='RETRY_EXHAUSTED',dead_lettered_at=?,lease_token=NULL,lease_until=0
    WHERE state<>'processed' AND dead_lettered_at IS NULL AND attempts>=? AND lease_until<=?`).run(now,INBOX_MAX_ATTEMPTS,now);
  return db.prepare(`UPDATE payment_inbox SET lease_token=?,lease_until=?,attempts=attempts+1
    WHERE event_key=(SELECT event_key FROM payment_inbox WHERE state<>'processed' AND dead_lettered_at IS NULL
      AND attempts<? AND next_retry_at<=? AND lease_until<=? ORDER BY received_at,event_key LIMIT 1)
    RETURNING *`).get(randomUUID(),now+INBOX_LEASE_MS,INBOX_MAX_ATTEMPTS,now,now);
}

export function finishInboxEvent(db, event, code = null, now = Date.now()) {
  // Fence stale workers: once a new lease is issued, an earlier worker cannot
  // overwrite its result. Trusted receipt completion has a separate atomic path.
  if (code===null) {
    return db.prepare(`UPDATE payment_inbox SET state='processed',last_error_code=NULL,lease_token=NULL,lease_until=0,dead_lettered_at=NULL
      WHERE event_key=? AND lease_token=? AND state<>'processed'`).run(event.event_key,event.lease_token).changes===1;
  }
  const exhausted=event.attempts>=INBOX_MAX_ATTEMPTS;
  const delay=Math.min(3_600_000,1000*2**Math.min(event.attempts-1,12));
  return db.prepare(`UPDATE payment_inbox SET state='failed',last_error_code=?,next_retry_at=?,lease_token=NULL,lease_until=0,dead_lettered_at=?
    WHERE event_key=? AND lease_token=? AND state<>'processed'`).run(code,now+delay,exhausted?now:null,event.event_key,event.lease_token).changes===1;
}
