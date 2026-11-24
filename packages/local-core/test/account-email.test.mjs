import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {createLocalBackup,restoreLocalBackup} from '../src/backup.mjs';

test('email ownership and recovery: purpose, ownership, expiry, replay, revocation and no HTTP token leakage',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'account-email-')),path=join(dir,'local.sqlite');
 const store=openLocalStore(path),sent=[];
 const mail={environment:'synthetic',send:async challenge=>{sent.push(challenge);}};
 const pw='Synthetic Student Password 2026',replacement='Synthetic Changed Password 2026';
 const email='student@email.test',otherEmail='other@email.test',operatorEmail='operator@email.test';
 const req=async(route,body,session,delivery=mail)=>{
  const request=new Request('http://localhost:3000/api/local/'+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json',origin:'http://localhost:3000'}),...(session?{cookie:'campus_local_session='+session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const res=await createLocalHandler(store,{emailDelivery:delivery})(request,route.split('/'));
  return {status:res.status,data:await res.json()};
 };
 try{
  store.bootstrapAdmin(operatorEmail,pw);
  const admin=store.login(operatorEmail,pw);
  const campus=store.createInstitution(admin.user,'Synthetic Email Campus');
  const student=store.register({email,password:pw,institutionId:campus.id});
  store.register({email:otherEmail,password:pw,institutionId:campus.id});
  const a=store.login(email,pw),b=store.login(otherEmail,pw),a2=store.login(email,pw);
  assert.equal((await req('me/email-status',undefined,a.token)).data.emailVerified,false);
  assert.equal((await req('auth/email/verify/request',{},a.token,null)).status,503);
  assert.equal((await req('auth/email/verify/request',{})).status,401);
  assert.equal((await req('auth/email/verify/request',{email:otherEmail},a.token)).status,400);
  assert.deepEqual(await req('auth/password/recover',{email}),await req('auth/password/recover',{email:'absent@email.test'}));
  assert.equal(sent.length,0);
  assert.deepEqual(await req('auth/email/verify/request',{},a.token),{status:202,data:{accepted:true}});
  const verification=sent.at(-1);
  assert.equal(verification.to,email);assert.equal(verification.purpose,'verify');
  await req('auth/email/verify/request',{},a.token);assert.equal(sent.length,1);
  assert.equal((await req('auth/email/verify/confirm',{token:verification.token},b.token)).status,422);
  assert.equal((await req('auth/password/reset',{token:verification.token,password:replacement})).status,422);
  const sql=new DatabaseSync(path);
  try{
   const row=sql.prepare('SELECT token_hash FROM account_email_challenges WHERE user_id=?').get(student.id);
   assert.match(row.token_hash,/^[a-f0-9]{64}$/);assert.notEqual(row.token_hash,verification.token);
  }finally{sql.close();}
  assert.equal((await req('auth/email/verify/confirm',{token:verification.token},a.token)).status,200);
  assert.equal((await req('auth/email/verify/confirm',{token:verification.token},a.token)).status,422);
  assert.equal((await req('me/email-status',undefined,a.token)).data.emailVerified,true);
  assert.equal((await req('me/email-status',undefined,b.token)).data.emailVerified,false);
  assert.deepEqual(await req('auth/password/recover',{email}),await req('auth/password/recover',{email:operatorEmail}));
  const recovery=sent.at(-1);assert.equal(recovery.purpose,'recover');
  assert.equal((await req('auth/email/verify/confirm',{token:recovery.token},a.token)).status,422);
  assert.equal((await req('auth/password/reset',{token:recovery.token,password:'short'})).status,422);
  assert.equal((await req('auth/password/reset',{token:recovery.token,password:replacement})).status,200);
  assert.equal((await req('auth/password/reset',{token:recovery.token,password:pw})).status,422);
  assert.equal(store.getSession(a.token),null);assert.equal(store.getSession(a2.token),null);assert.ok(store.getSession(b.token));
  assert.equal(store.login(email,pw),null);assert.ok(store.login(email,replacement));
  await req('auth/password/recover',{email});
  const expired=sent.at(-1);
  const expireDb=new DatabaseSync(path);try{expireDb.prepare('UPDATE account_email_challenges SET expires_at=0,issued_at=0').run();}finally{expireDb.close();}
  assert.equal((await req('auth/password/reset',{token:expired.token,password:pw})).status,422);
  await req('auth/password/recover',{email});const suspended=sent.at(-1);
  store.setStudentSuspension(admin.token,student.id,{suspended:true,reason:'Synthetic review'});
  store.setStudentSuspension(admin.token,student.id,{suspended:false,reason:'Synthetic reinstatement'});
  assert.equal((await req('auth/password/reset',{token:suspended.token,password:pw})).status,422);
  await req('auth/password/recover',{email});const beforeBackup=sent.at(-1);
  const snapshotDir=join(dir,'snapshot');await createLocalBackup({databasePath:path,snapshotDir});
  const restoredPath=join(dir,'restored.sqlite');restoreLocalBackup({snapshotDir,databasePath:restoredPath});
  const restored=openLocalStore(restoredPath);
  try{assert.throws(()=>restored.resetPassword(beforeBackup.token,pw),/INVALID_EMAIL_CHALLENGE/);assert.ok(restored.login(email,replacement));}
  finally{restored.close();}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('account email request limits survive challenge cancellation and failed delivery never leaves a usable token',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'email-abuse-')),path=join(dir,'local.sqlite'),store=openLocalStore(path);
 const pw='Synthetic Student Password 2026',email='student@abuse.test',sent=[];
 const request=async(route,body,session,delivery)=>{
  const req=new Request('http://localhost:3000/api/local/'+route,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...(session?{cookie:'campus_local_session='+session}:{})},body:JSON.stringify(body)});
  const res=await createLocalHandler(store,{emailDelivery:delivery})(req,route.split('/'));
  return {status:res.status,data:await res.json()};
 };
 const failing={environment:'synthetic',send:async challenge=>{sent.push(challenge);throw Error('Synthetic failure');}};
 const good={environment:'synthetic',send:async challenge=>{sent.push(challenge);}};
 try{
  store.bootstrapAdmin('operator@abuse.test',pw);
  const admin=store.login('operator@abuse.test',pw),campus=store.createInstitution(admin.user,'Synthetic Abuse Campus');
  store.register({email,password:pw,institutionId:campus.id});
  const session=store.login(email,pw);
  for(let i=0;i<8;i++){
   assert.deepEqual(await request('auth/email/verify/request',{},session.token,failing),{status:202,data:{accepted:true}});
   assert.equal((await request('auth/email/verify/confirm',{token:sent.at(-1).token},session.token,good)).status,422);
  }
  assert.equal(sent.length,8);
  assert.equal((await request('auth/email/verify/request',{},session.token,good)).status,202);
  assert.equal(sent.length,8);
  for(let i=0;i<9;i++)assert.deepEqual(await request('auth/password/recover',{email:'absent@abuse.test'},null,good),{status:202,data:{accepted:true}});
  const db=new DatabaseSync(path);
  try{
   const rows=db.prepare('SELECT request_digest FROM account_email_requests').all();
   assert.equal(rows.length,16);assert.ok(rows.every(r=>/^[a-f0-9]{64}$/.test(r.request_digest)));
   assert.equal(db.prepare('SELECT count(*) AS n FROM account_email_challenges').get().n,0);
   db.prepare('UPDATE account_email_requests SET requested_at=0').run();
  }finally{db.close();}
  assert.equal((await request('auth/email/verify/request',{},session.token,good)).status,202);
  assert.equal(sent.length,9);
  assert.equal((await request('auth/email/verify/confirm',{token:sent.at(-1).token},session.token,good)).status,200);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
