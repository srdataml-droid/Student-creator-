import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readCreatorJournal } from '../src/creator-journal.mjs';

test('creator earnings use only posted creator-payable lines scoped to the creator', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE purchase_orders(reference TEXT PRIMARY KEY, creator_id TEXT, status TEXT, creator_share_kobo INTEGER);
      CREATE TABLE commerce_events(event_key TEXT PRIMARY KEY, order_reference TEXT, state TEXT);
      CREATE TABLE commerce_lines(event_key TEXT, account TEXT, debit_kobo INTEGER, credit_kobo INTEGER);
      INSERT INTO purchase_orders VALUES ('a','creator-a','paid',99000), ('b','creator-a','paid',20000), ('c','creator-b','paid',30000), ('d','creator-a','paid',50000);
      INSERT INTO commerce_events VALUES ('charge-a','a','posted'), ('charge-b','b','posted'), ('charge-c','c','posted'), ('draft-d','d','draft'), ('duplicate-a','a','posted'), ('fee-a','a','posted');
      INSERT INTO commerce_lines VALUES ('charge-a','creator_payable',0,20000), ('charge-b','creator_payable',0,25000), ('charge-c','creator_payable',0,30000), ('draft-d','creator_payable',0,50000), ('duplicate-a','duplicate_payable',0,20000), ('fee-a','provider_fee_suspense',100,0);
    `);
    const summary = id => ({...readCreatorJournal(db, id)});
    assert.deepEqual(summary('creator-a'), { pending:45000, count:2 });
    assert.deepEqual(summary('creator-b'), { pending:30000, count:1 });
    assert.deepEqual(summary('unknown'), { pending:0, count:0 });
    db.exec(`INSERT INTO commerce_events VALUES ('refund-a','a','posted'); INSERT INTO commerce_lines VALUES ('refund-a','creator_payable',20000,0);`);
    assert.deepEqual(summary('creator-a'), { pending:25000, count:1 });
    db.exec(`UPDATE purchase_orders SET status='pending', creator_share_kobo=1 WHERE reference='b';`);
    assert.deepEqual(summary('creator-a'), { pending:25000, count:1 });
  } finally { db.close(); }
});
