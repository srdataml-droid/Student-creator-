/** Only opens a newly created synthetic database. No live PSP or hosted calls. */
import assert from 'node:assert/strict';
import {rmSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {commerceFixture} from '../packages/local-core/test/helpers/commerce-fixture.mjs';
if(process.env.CI!=='true'||process.env.APP_DATA_MODE!=='local'||!process.argv[2])
 throw Error('DISPOSABLE_CI_REQUIRED');
const baseline=resolve(process.argv[2]);
const {openLocalStore}=await import(pathToFileURL(resolve(baseline,'packages/local-core/src/store.mjs')));
const {createLocalHandler}=await import(pathToFileURL(resolve(baseline,'packages/local-core/src/http.mjs')));
const f=commerceFixture();
let old,db,currentOpen=true;
try{
 f.store.applyVerifiedTestCharge(f.order.reference,f.response());
 const before=f.db.prepare('SELECT SUM(debit_kobo) debit,SUM(credit_kobo) credit,COUNT(*) count FROM commerce_journal').get();
 assert.equal(before.debit,before.credit);
 f.db.close();f.store.close();currentOpen=false;
 // Start the previous implementation on the same disposable database and media.
 old=openLocalStore(f.path);
 const handle=createLocalHandler(old);
 const req=async(route,session,method='GET')=>handle(new Request('http://localhost:3000/api/local/'+route,{
   method,headers:{...(session?{cookie:'campus_local_session='+session}:{}),...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},
   ...(method==='POST'?{body:'{}'}:{})
 }),route.split('/'));
 assert.equal((await req('me',f.buyer.token)).status,200);
 assert.equal((await req('lessons/'+f.id,null)).status,401);
 assert.equal((await req('lessons/'+f.id,f.other.token)).status,402);
 assert.equal((await req('lessons/'+f.id,f.buyer.token)).status,200);
 const grant=old.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token);
 assert.deepEqual(readFileSync(old.getVideoFile(f.buyer.user,f.id,grant.token,f.buyer.token).file),f.video);
 assert.equal(old.applyVerifiedTestCharge(f.order.reference,f.response()).replayed,true);
 db=new DatabaseSync(f.path);
 const after=db.prepare('SELECT SUM(debit_kobo) debit,SUM(credit_kobo) credit,COUNT(*) count FROM commerce_journal').get();
 assert.deepEqual(after,before);
 old.applySyntheticRefund(f.order.reference,{refundReference:'synthetic-rollback-refund',providerTransactionId:'synthetic_tx_1'});
 assert.equal((await req('lessons/'+f.id,f.buyer.token)).status,402);
 assert.throws(()=>old.getVideoFile(f.buyer.user,f.id,grant.token,f.buyer.token));
 const refunded=db.prepare('SELECT SUM(debit_kobo) debit,SUM(credit_kobo) credit,COUNT(*) count FROM commerce_journal').get();
 assert.equal(refunded.debit,refunded.credit);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM content_entitlements WHERE state='active'").get().n,0);
 console.log('Synthetic rollback checks passed: previous code read current auth, protected media and ledger; replay and refund invariants preserved.');
}finally{
 try{db?.close();}finally{
  try{old?.close();}finally{
   if(currentOpen)f.close();else rmSync(f.dir,{recursive:true,force:true});
  }
 }
}
