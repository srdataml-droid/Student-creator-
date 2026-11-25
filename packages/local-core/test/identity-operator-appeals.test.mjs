import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

test('operator appeal queue is private and decisions cannot grant student eligibility',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'identity-operator-')),store=openLocalStore(join(dir,'local.sqlite'));
 const pw='Synthetic Student Password 2026';
 const request=async(path,token,body)=>{
  const req=new Request('http://localhost:3000/api/local/'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{cookie:'campus_local_session='+token}:{}),...(body===undefined?{}:{origin:'http://localhost:3000','content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const res=await createLocalHandler(store)(req,path.split('/'));
  return {status:res.status,data:await res.json()};
 };
 try{
  store.bootstrapAdmin('operator@identity.test',pw);
  const admin=store.login('operator@identity.test',pw),campus=store.createInstitution(admin.user,'Synthetic Identity Campus');
  const student=store.register({email:'student@identity.test',password:pw,institutionId:campus.id});
  store.register({email:'other@identity.test',password:pw,institutionId:campus.id});
  const a=store.login('student@identity.test',pw),b=store.login('other@identity.test',pw);
  const reason='Synthetic review requested for incorrect membership classification.';
  const created=await request('me/verification-appeals',a.token,{reason});
  assert.equal(created.status,201);
  const id=created.data.appeal.caseId,queue='admin/verification-appeals';
  assert.equal((await request(queue)).status,401);
  assert.equal((await request(queue,b.token)).status,403);
  assert.deepEqual((await request('me/verification-appeals',b.token)).data.appeals,[]);
  assert.equal((await request(queue+'/'+id,b.token,{decision:'review_requested',note:'Not an authorized operator'})).status,403);
  const open=await request(queue,admin.token);
  assert.equal(open.status,200);assert.equal(open.data.appeals.length,1);
  assert.deepEqual(Object.keys(open.data.appeals[0]).sort(),['caseId','createdAt','reason','userId']);
  assert.equal(open.data.appeals[0].userId,student.id);assert.equal(open.data.appeals[0].reason,reason);
  const decision=await request(queue+'/'+id,admin.token,{decision:'review_requested',note:'Synthetic review only; obtain new proof.'});
  assert.equal(decision.status,200);assert.equal(decision.data.appeal.eligibilityUnchanged,true);
  assert.equal(store.getSession(a.token).verifiedAt,null);
  assert.deepEqual((await request(queue,admin.token)).data.appeals,[]);
  assert.equal((await request('me/verification-appeals',a.token)).data.appeals[0].status,'review_requested');
  assert.equal((await request(queue+'/'+id,admin.token,{decision:'rejected',note:'Synthetic second decision not allowed.'})).status,404);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
