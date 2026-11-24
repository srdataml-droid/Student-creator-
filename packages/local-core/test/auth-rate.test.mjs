import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';

test('login throttling: nonenumerating responses, private email digests, durable lockout and expiry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'auth-rate-')),path=join(dir,'local.sqlite');
 let store=openLocalStore(path);
 const password='Synthetic Strong Operator Password 2026',email='operator@synthetic.invalid';
 try{
  store.bootstrapAdmin(email,password);
  const good=store.login(email,password);
  assert.equal(good.user.role,'admin');
  for(let attempt=0;attempt<8;attempt++)assert.equal(store.login(email,'incorrect-secret-string'),null);
  assert.equal(store.login(email,password),null);
  for(let attempt=0;attempt<8;attempt++)assert.equal(store.login('missing@synthetic.invalid','wrong-secret-string'),null);
  assert.equal(store.login('missing@synthetic.invalid',password),null);
  const audit=store.auditCount();
  store.close();store=openLocalStore(path);
  assert.equal(store.login(email,password),null);
  const db=new DatabaseSync(path);
  try{
   const rows=db.prepare('SELECT email_digest,occurred_at FROM auth_failed_logins').all();
   assert.ok(rows.length>=16);
   for(const r of rows){assert.match(r.email_digest,/^[0-9a-f]{64}$/);assert.equal(r.email_digest.includes(email),false);}
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_failed_logins WHERE email_digest=?').get(email).n,0);
   const secret=db.prepare('SELECT secret FROM auth_throttle_secret WHERE id=1').get();
   assert.match(secret.secret,/^[0-9a-f]{64}$/);
   // Advance only synthetic database event timestamps; no sleeps or wall-clock changes.
   db.prepare('UPDATE auth_failed_logins SET occurred_at=?').run(Math.floor(Date.now()/1000)-1000);
  }finally{db.close();}
  const fresh=store.login(email,password);
  assert.ok(fresh?.token);
  assert.equal(store.auditCount()>audit,true);
  assert.equal(store.login('missing@synthetic.invalid',password),null);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
