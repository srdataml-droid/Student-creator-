import test from 'node:test';
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {commerceFixture} from './helpers/commerce-fixture.mjs';
import {createLocalHandler} from '../src/http.mjs';
test('paid media HTTP authorization, watermark privacy and restriction dispute path',async()=>{
 const f=commerceFixture();try{
  const handle=createLocalHandler(f.store);
  const req=async(suffix='',who=f.buyer,method='GET',extra={})=>{
   const path=`lessons/${f.id}/${suffix}`;
   return handle(new Request('http://localhost:3000/api/local/'+path,{method,headers:{...(who?{cookie:`campus_local_session=${who.token}`} :{}),...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{}),...extra},...(method==='POST'?{body:'{}'}:{})}),path.split('/'));
  };
  for(const method of ['GET','HEAD']){
   assert.equal((await req('video',null,method)).status,401);
   assert.equal((await req('video',f.unverified,method)).status,403);
   assert.equal((await req('video',f.buyer,method)).status,402);
  }
  assert.equal((await req('video',f.other,'GET',{range:'bytes=0-4'})).status,402);
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  const issued=await req('playback-grant',f.buyer,'POST'),json=await issued.json();
  assert.equal(issued.status,200);assert.equal(issued.headers.get('referrer-policy'),'no-referrer');
  assert.match(json.watermark.label,/^WK-[a-f0-9]{12} · [a-f0-9]{8}$/);
  assert.ok(!JSON.stringify(json).includes(f.buyer.user.id));assert.ok(!JSON.stringify(json).includes('@'));
  const next=f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token);assert.equal(next.watermark.label,json.watermark.label);
  const grant=issued.headers.get('set-cookie').split(';')[0],cookie=`campus_local_session=${f.buyer.token}; ${grant}`;
  const get=(whoCookie=cookie,headers={})=>req('video',f.buyer,'GET',{cookie:whoCookie,...headers});
  assert.equal((await get()).status,200);assert.equal((await get(cookie,{range:'bytes=0-4'})).status,206);
  assert.equal((await get(`campus_local_session=${f.other.token}; ${grant}`)).status,402);
  assert.equal((await get(grant)).status,401);
  assert.equal((await get(cookie.replace(/.$/,'!'))).status,403);
  const privateFile=f.store.getVideoFile(f.buyer.user,f.id,next.token,f.buyer.token).file;
  assert.equal(statSync(privateFile).mode&0o077,0);
  assert.ok(!privateFile.includes('/public/'));assert.ok(!JSON.stringify(json).includes(privateFile));
  f.db.exec("UPDATE content_entitlements SET state='suspended'");assert.equal((await get()).status,402);
  f.db.exec("UPDATE content_entitlements SET state='active'");
  f.store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:true,comment:false,message:false});
  assert.equal((await get(cookie,{range:'bytes=0-4'})).status,403);
  const cases=f.store.myPaymentDisputes(f.buyer.user);assert.equal(cases.length,1);assert.equal(cases[0].kind,'creator_view_restriction');
  assert.equal(f.store.myPaymentDisputes(f.other.user).length,0);
  f.store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:false,comment:true,message:false});
  assert.equal((await get()).status,403);
  const fresh=f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token);
  assert.ok(f.store.getVideoFile(f.buyer.user,f.id,fresh.token,f.buyer.token));
  f.db.exec('UPDATE users SET suspended=1 WHERE id=\''+f.buyer.user.id+'\'');
  assert.throws(()=>f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token),/VERIFICATION_REQUIRED/);
 }finally{f.close();}
});
test('private preview authorization and playback session expiry use persisted state',()=>{
 const f=commerceFixture();try{
  f.db.prepare("UPDATE lessons SET status='draft' WHERE id=?").run(f.id);
  assert.ok(f.store.getVideoFile(f.creator.user,f.id));
  f.db.prepare('UPDATE users SET suspended=1 WHERE id=?').run(f.creator.user.id);
  assert.throws(()=>f.store.getVideoFile(f.creator.user,f.id),/VIDEO_NOT_FOUND/);
  f.db.prepare('UPDATE users SET suspended=0 WHERE id=?').run(f.creator.user.id);
  f.db.prepare("UPDATE lessons SET status='published' WHERE id=?").run(f.id);
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  const grant=f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token);
  f.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(f.buyer.user.id);
  assert.throws(()=>f.store.getVideoFile(f.buyer.user,f.id,grant.token,f.buyer.token),/PLAYBACK_GRANT_REQUIRED/);
 }finally{f.close();}
});
test('grant cannot outlive the login session even when the grant itself has not expired',()=>{
 const f=commerceFixture();try{
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  const grant=f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token);
  f.db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(f.buyer.user.id);
  assert.throws(()=>f.store.getVideoFile(f.buyer.user,f.id,grant.token,f.buyer.token),/PLAYBACK_GRANT_REQUIRED/);
 }finally{f.close();}
});
test('grant issuance rechecks authorization after waiting on another SQLite writer',async()=>{
 const {fork}=await import('node:child_process');const {once}=await import('node:events');
 const f=commerceFixture();try{
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  const child=fork(new URL('./helpers/restriction-worker.mjs',import.meta.url),[f.path,f.creator.user.id,f.buyer.user.id],{stdio:['ignore','ignore','ignore','ipc']});
  await once(child,'message');const exit=once(child,'exit');child.send('go');
  assert.throws(()=>f.store.issuePlaybackGrant(f.buyer.user,f.id,f.buyer.token),/CREATOR_ACCESS_RESTRICTED/);
  await exit;assert.equal(f.db.prepare('SELECT count(*) n FROM playback_grants').get().n,0);
 }finally{f.close();}
});
test('a new viewing restriction after resolved review opens a new case without deleting history',()=>{
 const f=commerceFixture();try{
  f.store.applyVerifiedTestCharge(f.order.reference,f.response());
  f.store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:true,comment:false,message:false});
  const old=f.store.myPaymentDisputes(f.buyer.user)[0];
  f.store.resolvePaymentDispute(f.admin.user,old.caseKey,'Synthetic reviewed restriction and release');
  f.store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:false,comment:false,message:false});
  f.store.setCreatorRestrictions(f.creator.user,f.creator.user.id,f.buyer.user.id,{view:true,comment:false,message:false});
  const cases=f.store.myPaymentDisputes(f.buyer.user);assert.equal(cases.length,2);assert.equal(cases.filter(c=>c.status==='open').length,1);assert.equal(cases.filter(c=>c.status==='resolved').length,1);
 }finally{f.close();}
});
