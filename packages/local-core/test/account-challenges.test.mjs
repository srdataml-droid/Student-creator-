import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('email challenge and password reset: private delivery, purpose and owner binding, expiry, replay and session revocation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'account-challenge-')),path=join(dir,'local.sqlite'),store=openLocalStore(path);
 const pw='Synthetic Password Original 2026',fresh='Synthetic Password Changed 2026',mail=[];
 const request=async(route,body,token,enabled=true)=>{
  const req=new Request('http://localhost:3000/api/local/'+route,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...(token?{cookie:'campus_local_session='+token}:{})},body:JSON.stringify(body)});
  const res=await createLocalHandler(store,enabled?{accountMailer:async msg=>mail.push(msg)}:{})(req,route.split('/'));
  return {status:res.status,data:await res.json()};
 };
 try{
  store.bootstrapAdmin('admin@challenge.test',pw);
  const admin=store.login('admin@challenge.test',pw);
  const institutionId=store.createInstitution(admin.user,'Synthetic Challenge Campus').id;
  const email='student@challenge.test',otherEmail='other@challenge.test';
  store.register({email,password:pw,institutionId});store.register({email:otherEmail,password:pw,institutionId});
  const user=store.login(email,pw),other=store.login(otherEmail,pw),second=store.login(email,pw);
  assert.equal((await request('auth/password/request',{email},null,false)).status,503);
  const unverified=await request('auth/password/request',{email});
  assert.deepEqual(unverified,await request('auth/password/request',{email:'missing@challenge.test'}));
  assert.equal(mail.length,0);
  assert.equal((await request('auth/email/request',{email},other.token)).status,202);
  assert.equal(mail.length,0);
  const issued=await request('auth/email/request',{email},user.token);
  assert.deepEqual(issued,{status:202,data:{accepted:true}});
  const proof=mail[0].token;
  assert.equal((await request('auth/email/confirm',{token:proof},other.token)).status,422);
  assert.equal((await request('auth/password/reset',{token:proof,password:fresh})).status,422);
  assert.equal((await request('auth/email/confirm',{token:proof},user.token)).status,200);
  assert.equal((await request('auth/email/confirm',{token:proof},user.token)).status,422);
  assert.ok(store.getSession(user.token).emailVerifiedAt);
  assert.equal(store.getSession(user.token).verifiedAt,null);
  assert.deepEqual(await request('auth/password/request',{email}),unverified);
  const expired=mail.at(-1).token;
  const db=new DatabaseSync(path);
  try{
   const rows=db.prepare('SELECT token_hash FROM account_challenges').all();
   assert.equal(rows.length,1);assert.match(rows[0].token_hash,/^[a-f0-9]{64}$/);
   assert.notEqual(rows[0].token_hash,expired);
   db.prepare('UPDATE account_challenges SET expires_at=0').run();
  }finally{db.close();}
  assert.equal((await request('auth/password/reset',{token:expired,password:fresh})).status,422);
  await request('auth/password/request',{email});
  const reset=mail.at(-1).token;
  assert.notEqual(reset,expired);
  assert.equal((await request('auth/password/reset',{token:reset,password:'short'})).status,422);
  assert.equal((await request('auth/password/reset',{token:reset,password:fresh})).status,200);
  assert.equal((await request('auth/password/reset',{token:reset,password:pw})).status,422);
  assert.equal(store.getSession(user.token),null);assert.equal(store.getSession(second.token),null);
  assert.ok(store.getSession(other.token));assert.ok(store.getSession(admin.token));
  assert.equal(store.login(email,pw),null);assert.ok(store.login(email,fresh)?.token);
  assert.ok(store.login(otherEmail,pw)?.token);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
