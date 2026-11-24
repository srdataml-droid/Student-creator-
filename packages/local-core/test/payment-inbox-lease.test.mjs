import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateInboxLeases,claimInboxEvent,finishInboxEvent,INBOX_LEASE_MS,INBOX_MAX_ATTEMPTS } from '../src/payment-inbox-lease.mjs';
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'inbox-lease-')),path=join(dir,'db.sqlite'),db=new DatabaseSync(path);
  db.exec(`CREATE TABLE payment_inbox(event_key TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'received', attempts INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER NOT NULL DEFAULT 0, last_error_code TEXT, received_at TEXT NOT NULL);
    INSERT INTO payment_inbox(event_key,received_at) VALUES('event-1','2026-11-24');`);
  migrateInboxLeases(db);
  return {db,path,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('one active lease across independent connections; an expired owner cannot overwrite a new owner',()=>{
  const f=fixture(),other=new DatabaseSync(f.path);try{
    const first=claimInboxEvent(f.db,1000);
    assert.equal(first.attempts,1);
    assert.equal(claimInboxEvent(other,1001),undefined);
    const second=claimInboxEvent(other,1000+INBOX_LEASE_MS);
    assert.equal(second.attempts,2);assert.notEqual(second.lease_token,first.lease_token);
    assert.equal(finishInboxEvent(f.db,first,'GATEWAY_TIMEOUT',1000+INBOX_LEASE_MS),false);
    assert.equal(finishInboxEvent(other,second,null,1000+INBOX_LEASE_MS),true);
    assert.equal(f.db.prepare('SELECT state FROM payment_inbox').get().state,'processed');
  }finally{other.close();f.close();}
});
test('failure retries back off and are bounded, with a durable dead letter',()=>{
  const f=fixture();try{
    let now=1000;
    for(let n=1;n<=INBOX_MAX_ATTEMPTS;n++){
      const event=claimInboxEvent(f.db,now);assert.equal(event.attempts,n);
      assert.equal(finishInboxEvent(f.db,event,'GATEWAY_TIMEOUT',now),true);
      assert.equal(claimInboxEvent(f.db,now),undefined);
      now=f.db.prepare('SELECT next_retry_at FROM payment_inbox').get().next_retry_at;
    }
    assert.equal(claimInboxEvent(f.db,now+10_000_000),undefined);
    const reopened=new DatabaseSync(f.path);try{
      migrateInboxLeases(reopened);
      const row=reopened.prepare('SELECT state,attempts,dead_lettered_at FROM payment_inbox').get();
      assert.equal(row.state,'failed');assert.equal(row.attempts,INBOX_MAX_ATTEMPTS);assert.ok(row.dead_lettered_at>0);
    }finally{reopened.close();}
  }finally{f.close();}
});
test('expired final attempt is dead-lettered after process-equivalent reopen',()=>{
  const f=fixture();try{
    f.db.prepare('UPDATE payment_inbox SET attempts=?').run(INBOX_MAX_ATTEMPTS-1);
    const event=claimInboxEvent(f.db,1000);assert.equal(event.attempts,INBOX_MAX_ATTEMPTS);
    const reopened=new DatabaseSync(f.path);try{
      assert.equal(claimInboxEvent(reopened,1001),undefined);
      assert.equal(reopened.prepare('SELECT dead_lettered_at FROM payment_inbox').get().dead_lettered_at,null);
      assert.equal(claimInboxEvent(reopened,1000+INBOX_LEASE_MS),undefined);
      const row=reopened.prepare('SELECT last_error_code,dead_lettered_at FROM payment_inbox').get();
      assert.equal(row.last_error_code,'RETRY_EXHAUSTED');assert.equal(row.dead_lettered_at,1000+INBOX_LEASE_MS);
      assert.equal(finishInboxEvent(f.db,event,'GATEWAY_TIMEOUT',1000+INBOX_LEASE_MS),false);
    }finally{reopened.close();}
  }finally{f.close();}
});
