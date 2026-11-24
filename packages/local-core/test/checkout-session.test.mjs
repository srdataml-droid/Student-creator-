import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeCheckoutSession, migrateCheckoutSessions } from '../src/checkout-session.mjs';
const error = (code,status) => Object.assign(new Error(code),{code,status});
const order = {reference:'synthetic-reference',amountKobo:20000,domain:'test',buyerEmail:'buyer@example.invalid'};
const result = {reference:order.reference,authorizationUrl:'https://checkout.paystack.com/synthetic'};
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'checkout-session-')),path=join(dir,'checkout.sqlite');
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE purchase_orders(reference TEXT PRIMARY KEY);');
  db.prepare('INSERT INTO purchase_orders VALUES(?)').run(order.reference);
  migrateCheckoutSessions(db);
  return {db,path,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('concurrent connections share one checkout initialization and persist it across reopen',async()=>{
  const f=fixture(),other=new DatabaseSync(f.path);try{
    let calls=0,release;
    const gateway={initialize:async()=>{calls++;await new Promise(resolve=>{release=resolve;});return result;}};
    const first=initializeCheckoutSession(f.db,order,gateway,error);
    await assert.rejects(initializeCheckoutSession(other,order,gateway,error),{code:'CHECKOUT_INITIALIZATION_UNCERTAIN'});
    release();assert.deepEqual(await first,result);
    other.close();const reopened=new DatabaseSync(f.path);try{
      migrateCheckoutSessions(reopened);
      assert.deepEqual(await initializeCheckoutSession(reopened,order,gateway,error),result);
      assert.equal(calls,1);
    }finally{reopened.close();}
  }finally{if(other.isOpen)other.close();f.close();}
});
test('timeout preserves unknown state and blocks another initialization',async()=>{
  const f=fixture();try{
    let calls=0;const gateway={initialize:async()=>{calls++;throw error('GATEWAY_TIMEOUT',503);}};
    await assert.rejects(initializeCheckoutSession(f.db,order,gateway,error),{code:'GATEWAY_TIMEOUT'});
    assert.equal(f.db.prepare('SELECT state FROM checkout_sessions').get().state,'uncertain');
    await assert.rejects(initializeCheckoutSession(f.db,order,gateway,error),{code:'CHECKOUT_INITIALIZATION_UNCERTAIN'});
    assert.equal(calls,1);
  }finally{f.close();}
});
test('interrupted initialization remains ambiguous after database reopen',async()=>{
  const f=fixture();try{
    f.db.prepare("INSERT INTO checkout_sessions VALUES(?,'started',NULL,?)").run(order.reference,new Date().toISOString());
    const reopened=new DatabaseSync(f.path);try{
      await assert.rejects(initializeCheckoutSession(reopened,order,{initialize:async()=>assert.fail('must not initialize again')},error),{code:'CHECKOUT_INITIALIZATION_UNCERTAIN'});
    }finally{reopened.close();}
  }finally{f.close();}
});
test('untrusted returned checkout cannot be cached or delivered',async()=>{
  const f=fixture();try{
    await assert.rejects(initializeCheckoutSession(f.db,order,{initialize:async()=>({...result,authorizationUrl:'https://checkout.paystack.com:444/synthetic'})},error),{code:'INVALID_CHECKOUT_RESPONSE'});
    assert.deepEqual({...f.db.prepare('SELECT state,authorization_url FROM checkout_sessions').get()},{state:'uncertain',authorization_url:null});
  }finally{f.close();}
});
test('fresh and persisted checkout destinations share the same validation boundary',async()=>{
  for(const authorizationUrl of ['https://evil.example/checkout','http://checkout.paystack.com/synthetic','https://user:secret@checkout.paystack.com/synthetic','https://checkout.paystack.com:444/synthetic','https://checkout.paystack.com/synthetic#unexpected','not a URL']){
    const f=fixture();try{
      await assert.rejects(initializeCheckoutSession(f.db,order,{initialize:async()=>({...result,authorizationUrl})},error),{code:'INVALID_CHECKOUT_RESPONSE'});
      assert.equal(f.db.prepare('SELECT state FROM checkout_sessions').get().state,'uncertain');
      f.db.prepare("UPDATE checkout_sessions SET state='ready',authorization_url=? WHERE order_reference=?").run(authorizationUrl,order.reference);
      await assert.rejects(initializeCheckoutSession(f.db,order,{initialize:async()=>assert.fail('must not initialize another checkout')},error),{code:'INVALID_CHECKOUT_RESPONSE'});
      assert.equal(f.db.prepare('SELECT state FROM checkout_sessions').get().state,'ready');
    }finally{f.close();}
  }
});
