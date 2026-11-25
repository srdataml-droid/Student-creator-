import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readPurchaseReceipt} from '../src/purchase-receipt.mjs';
const error=(code,status)=>Object.assign(Error(code),{code,status});
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE purchase_orders(reference TEXT PRIMARY KEY,buyer_id TEXT,lesson_id TEXT,amount_kobo INTEGER,currency TEXT,environment TEXT,paid_at TEXT,payment_state TEXT);
 CREATE TABLE commerce_receipts(transaction_id TEXT PRIMARY KEY,order_reference TEXT,amount_kobo INTEGER,created_at TEXT,duplicate INTEGER);
 CREATE TABLE commerce_events(event_key TEXT PRIMARY KEY,order_reference TEXT,kind TEXT,state TEXT);
 CREATE TABLE commerce_lines(event_key TEXT,line_no INTEGER,account TEXT,debit_kobo INTEGER,credit_kobo INTEGER);
 CREATE TABLE commerce_reversals(event_key TEXT,order_reference TEXT,transaction_id TEXT,kind TEXT,created_at TEXT);
 INSERT INTO purchase_orders VALUES('order','buyer','lesson',20000,'NGN','test',NULL,'pending');`);
 const read=(buyer='buyer',ref='order')=>readPurchaseReceipt(db,buyer,ref,error);
 const pay=()=>db.exec(`UPDATE purchase_orders SET paid_at='2026-11-24T00:00:00Z',payment_state='paid';
 INSERT INTO commerce_receipts VALUES('primary','order',20000,'2026-11-24T00:00:00Z',0);
 INSERT INTO commerce_events VALUES('charge:primary','order','charge','posted');
 INSERT INTO commerce_lines VALUES('charge:primary',1,'processor_clearing',20000,0),('charge:primary',2,'creator_payable',0,20000);`);
 const reverse=(kind='refund')=>{db.prepare('INSERT INTO commerce_reversals VALUES(?,?,?,?,?)').run('reversal','order','primary',kind,'2026-11-25T00:00:00Z');db.prepare('UPDATE purchase_orders SET payment_state=?').run(kind==='refund'?'refunded':'chargeback');db.exec(`INSERT INTO commerce_events VALUES('reverse:primary','order','reversal','posted');INSERT INTO commerce_lines VALUES('reverse:primary',1,'creator_payable',20000,0),('reverse:primary',2,'processor_clearing',0,20000);`);};
 return {db,read,pay,reverse};
}
function run(fn){const f=fixture();try{fn(f)}finally{f.db.close();}}
test('no receipt before settlement; unknown and other buyer indistinguishable',()=>run(f=>{assert.throws(()=>f.read(),{code:'RECEIPT_UNAVAILABLE',status:409});assert.throws(()=>f.read('other'),{code:'ORDER_NOT_FOUND',status:404});assert.throws(()=>f.read('buyer','missing'),{code:'ORDER_NOT_FOUND',status:404});}));
test('settled receipt exposes only customer fields, stable original amount, explicit sandbox status',()=>run(f=>{f.pay();assert.deepEqual(f.read(),{reference:'order',lessonId:'lesson',currency:'NGN',environment:'test',amountKobo:20000,recordedAt:'2026-11-24T00:00:00Z',paidAt:'2026-11-24T00:00:00Z',status:'paid',reversedKobo:0,netKobo:20000,realMoneyCollected:false});assert.ok(Object.isFrozen(f.read()));assert.throws(()=>f.read('other'),{status:404});}));
test('duplicate receipt and duplicate reversal never inflate or reverse primary receipt',()=>run(f=>{f.pay();f.db.exec("INSERT INTO commerce_receipts VALUES('duplicate','order',20000,'2026-11-24',1);INSERT INTO commerce_reversals VALUES('dupe-reverse','order','duplicate','refund','2026-11-25');");assert.equal(f.read().netKobo,20000);assert.equal(f.read().status,'paid');}));
for(const kind of ['refund','chargeback'])test(kind+' retains original paid amount, records full reversal and zero net',()=>run(f=>{f.pay();f.reverse(kind);const x=f.read();assert.equal(x.amountKobo,20000);assert.equal(x.reversedKobo,20000);assert.equal(x.netKobo,0);assert.equal(x.status,kind==='refund'?'refunded':'chargeback');}));
test('refuses inconsistent accounting rather than making a receipt',()=>run(f=>{f.pay();f.db.exec("UPDATE commerce_lines SET credit_kobo=10000 WHERE line_no=2");assert.throws(()=>f.read(),{code:'RECEIPT_INTEGRITY_ERROR',status:503});}));
test('refuses unposted charge and missing reversal journal',()=>run(f=>{f.pay();f.db.exec("UPDATE commerce_events SET state='draft'");assert.throws(()=>f.read(),{status:503});f.db.exec("UPDATE commerce_events SET state='posted';UPDATE purchase_orders SET payment_state='refunded';INSERT INTO commerce_reversals VALUES('reversal','order',NULL,'refund','2026-11-25');");assert.throws(()=>f.read(),{status:503});}));
test('rejects non-test receipts and multiple purported primary receipts',()=>run(f=>{f.pay();f.db.exec("UPDATE purchase_orders SET environment='live'");assert.throws(()=>f.read(),{status:409});f.db.exec("UPDATE purchase_orders SET environment='test';INSERT INTO commerce_receipts VALUES('another','order',20000,'2026-11-24',0);");assert.throws(()=>f.read(),{status:503});}));
