import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrateCommerce} from '../src/commerce-schema.mjs';
test('legacy paid and refunded records migrate without losing journal or entitlement history',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE lessons(id TEXT PRIMARY KEY);
   INSERT INTO users VALUES('buyer'),('creator');INSERT INTO lessons VALUES('lesson');
   CREATE TABLE purchase_orders(reference TEXT PRIMARY KEY,buyer_id TEXT,creator_id TEXT,lesson_id TEXT,buyer_email TEXT,amount_kobo INTEGER,creator_share_kobo INTEGER,status TEXT,request_key TEXT,provider_transaction_id TEXT,created_at TEXT,paid_at TEXT);
   CREATE TABLE content_entitlements(buyer_id TEXT,lesson_id TEXT,order_reference TEXT UNIQUE REFERENCES purchase_orders(reference),granted_at TEXT,PRIMARY KEY(buyer_id,lesson_id));
   CREATE TABLE commerce_journal(order_reference TEXT REFERENCES purchase_orders(reference),line_no INTEGER,account TEXT,debit_kobo INTEGER,credit_kobo INTEGER,created_at TEXT,PRIMARY KEY(order_reference,line_no));
   CREATE TABLE synthetic_refunds(order_reference TEXT PRIMARY KEY,refund_reference TEXT,original_provider_transaction_id TEXT,created_at TEXT);
   INSERT INTO purchase_orders VALUES('legacy_order','buyer','creator','lesson','buyer@example.invalid',20000,20000,'paid','legacy_request','legacy_tx','2026-11-23','2026-11-23');
   INSERT INTO commerce_journal VALUES('legacy_order',1,'processor_clearing',20000,0,'2026-11-23'),('legacy_order',2,'creator_payable',0,20000,'2026-11-23'),('legacy_order',3,'creator_payable',20000,0,'2026-11-23'),('legacy_order',4,'processor_clearing',0,20000,'2026-11-23');
   INSERT INTO synthetic_refunds VALUES('legacy_order','legacy_refund','legacy_tx','2026-11-23');
  `);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
  migrateCommerce(db,transaction);migrateCommerce(db,transaction);
  assert.equal(db.prepare('SELECT payment_state FROM purchase_orders').get().payment_state,'refunded');
  assert.equal(db.prepare('SELECT state FROM content_entitlements').get().state,'revoked');
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_receipts').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_events').get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM commerce_journal').get().n,4);
  const lines=db.prepare('SELECT sum(debit_kobo) debit,sum(credit_kobo) credit FROM commerce_lines').get();
  assert.equal(lines.debit,40000);assert.equal(lines.credit,40000);
 }finally{db.close();}
});
