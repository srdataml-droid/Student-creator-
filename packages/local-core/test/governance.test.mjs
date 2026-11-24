import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'week7-governance-')),path=join(dir,'local.sqlite');
  const store=openLocalStore(path);
  const rootEmail='operator@week7.invalid',rootPassword='Synthetic Owner Private Password 2026';
  store.bootstrapAdmin(rootEmail,rootPassword);
  const owner=store.login(rootEmail,rootPassword);
  const school=store.createInstitution(owner.user,'Synthetic Governance Institute');
  const student=store.register({email:'student@week7.invalid',password:'Private Synthetic Student Password 2026',institutionId:school.id});
  const viewer=store.login('student@week7.invalid','Private Synthetic Student Password 2026');
  const secondId=randomUUID(),secondPw='Another Private Test Operator Password 2026',salt=randomBytes(16).toString('hex');
  const db=new DatabaseSync(path);
  db.prepare("INSERT INTO users(id,email,password_hash,salt,role,created_at) VALUES(?,?,?,?,'admin',?)")
    .run(secondId,'helper@week7.invalid',scryptSync(secondPw,salt,64).toString('hex'),salt,new Date().toISOString());
  db.close();
  const helper=store.login('helper@week7.invalid',secondPw);
  async function call(route,{method='GET',body,session}={}){
    const request=new Request('http://localhost:3000/api/local/'+route,{method,headers:{
      ...(session?{cookie:'campus_local_session='+session}:{}),
      ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})
    },...(body===undefined?{}:{body:JSON.stringify(body)})});
    const response=await createLocalHandler(store)(request,route.split('?')[0].split('/'));
    return {status:response.status,data:await response.json()};
  }
  return {store,path,owner,helper,viewer,student,secondId,call,finish(){store.close();rmSync(dir,{recursive:true,force:true});}};
}

test('week7 scopes reject visitors, students, unassigned staff and invented browser privileges',async()=>{
 const x=fixture();
 try{
  assert.equal((await x.call('admin/governance/dashboard')).status,401);
  assert.equal((await x.call('admin/governance/dashboard',{session:x.viewer.token})).status,403);
  assert.equal((await x.call('admin/privacy-requests',{session:x.viewer.token})).status,403);
  assert.equal((await x.call('admin/governance/dashboard',{session:x.helper.token})).status,403);
  const body={userId:x.student.id,role:'governance_owner'};
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body})).status,404);
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.helper.token,body:{userId:x.secondId,role:'governance_owner'}})).status,403);
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'root_superuser'}})).status,422);
  const own=await x.call('admin/governance/dashboard',{session:x.owner.token});
  assert.equal(own.status,200);
  assert.equal(own.data.dashboard.retentionAutomationEnabled,false);
  assert.equal(own.data.dashboard.livePaymentActionsEnabled,false);
  assert.equal(JSON.stringify(own.data).includes('student@week7.invalid'),false);
 }finally{x.finish();}
});
test('week7 delegated verification cannot read finance/privacy or appoint itself staff',async()=>{
 const x=fixture();
 try{
  let r=await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'verification_reviewer'}});
  assert.equal(r.status,200);assert.equal(r.data.grant.replayed,false);
  r=await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'verification_reviewer'}});
  assert.equal(r.status,200);assert.equal(r.data.grant.replayed,true);
  assert.equal((await x.call('admin/pending-users',{session:x.helper.token})).status,200);
  assert.equal((await x.call('admin/payment-disputes/dummy',{method:'POST',session:x.helper.token,body:{resolution:'reviewed'}})).status,403);
  assert.equal((await x.call('admin/copyright-claims',{session:x.helper.token})).status,403);
  assert.equal((await x.call('admin/governance/history',{session:x.helper.token})).status,403);
  assert.equal((await x.call('admin/governance/roles',{session:x.helper.token})).status,403);
  assert.equal((await x.call('admin/institution-integrations',{method:'POST',session:x.helper.token,body:{}})).status,403);
  assert.equal((await x.call('admin/governance/roles/revoke',{method:'POST',session:x.owner.token,body:{userId:x.owner.user.id,role:'governance_owner'}})).status,409);
 }finally{x.finish();}
});
test('week7 incidents require incident role, valid states, independent critical closure and rate limit',async()=>{
 const x=fixture();
 try{
  const payload={category:'data_exposure',severity:'critical',summary:'Synthetic staging data exposure suspected in a closed fixture.'};
  assert.equal((await x.call('admin/governance/incidents',{method:'POST',session:x.helper.token,body:payload})).status,403);
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'incident_responder'}})).status,200);
  let r=await x.call('admin/governance/incidents',{method:'POST',session:x.helper.token,body:payload});
  assert.equal(r.status,201);const id=r.data.incident.id;
  assert.equal((await x.call('admin/governance/incidents',{session:x.helper.token})).data.incidents.length,1);
  assert.equal((await x.call('admin/governance/incidents/'+id+'/state',{method:'POST',session:x.helper.token,body:{state:'resolved',note:'Skip triage'}})).status,409);
  assert.equal((await x.call('admin/governance/incidents/'+id+'/state',{method:'POST',session:x.helper.token,body:{state:'investigating',note:'Synthetic investigation initiated'}})).status,200);
  assert.equal((await x.call('admin/governance/incidents/'+id+'/state',{method:'POST',session:x.owner.token,body:{state:'contained',note:'Synthetic access limited and reviewed'}})).status,200);
  assert.equal((await x.call('admin/governance/incidents/'+id+'/state',{method:'POST',session:x.helper.token,body:{state:'resolved',note:'I alone approve this'}})).status,409);
  assert.equal((await x.call('admin/governance/incidents/'+id+'/state',{method:'POST',session:x.owner.token,body:{state:'resolved',note:'Independent synthetic review complete'}})).status,200);
  assert.equal((await x.call('admin/governance/incidents/'+id+'/state',{method:'POST',session:x.owner.token,body:{state:'investigating',note:'Undo state'}})).status,409);
  for(let i=1;i<10;i++)assert.equal((await x.call('admin/governance/incidents',{method:'POST',session:x.helper.token,body:{...payload,summary:payload.summary+' #'+i}})).status,201);
  assert.equal((await x.call('admin/governance/incidents',{method:'POST',session:x.helper.token,body:payload})).status,429);
  assert.equal((await x.call('admin/governance/dashboard',{session:x.helper.token})).status,200);
 }finally{x.finish();}
});
test('week7 retention proposals never delete records or silently approve policy; audit cannot be rewritten',async()=>{
 const x=fixture();
 try{
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'privacy_reviewer'}})).status,200);
  const p={dataset:'verification_evidence',days:30,rationale:'A proposed test-only retention review, without approved policy or deletion.'};
  const created=await x.call('admin/governance/retention',{method:'POST',session:x.helper.token,body:p});
  assert.equal(created.status,201);assert.equal(created.data.proposal.policyApproved,false);
  assert.equal(created.data.proposal.automaticDeletion,false);
  assert.equal((await x.call('admin/governance/retention',{session:x.helper.token})).status,403);
  assert.equal((await x.call('admin/governance/retention',{session:x.owner.token})).status,200);
  assert.equal((await x.call('admin/governance/retention/'+created.data.proposal.id+'/reject',{method:'POST',session:x.owner.token,body:{note:'Policy and legal requirements not reviewed'}})).status,200);
  assert.equal((await x.call('admin/governance/retention/'+created.data.proposal.id+'/reject',{method:'POST',session:x.owner.token,body:{note:'No second review'}})).status,409);
  const history=await x.call('admin/governance/history?limit=8',{session:x.owner.token});
  assert.equal(history.status,200);
  assert.ok(history.data.events.some(e=>e.action==='governance.retention.rejected'));
  assert.ok(history.data.events.every(e=>!Object.hasOwn(e,'detail')));
  assert.equal((await x.call('admin/governance/history?limit=1000',{session:x.owner.token})).status,422);
  const db=new DatabaseSync(x.path);
  try{
    assert.throws(()=>db.exec("DELETE FROM audit_events"),/AUDIT_APPEND_ONLY/);
    assert.throws(()=>db.exec("UPDATE audit_events SET action='forged'"),/AUDIT_APPEND_ONLY/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE role='student'").get().n,1);
  }finally{db.close();}
 }finally{x.finish();}
});


test('week7 server store methods reject cross-domain admin access even without HTTP middleware',async()=>{
 const x=fixture();
 try{
  const helper=x.helper.user;
  assert.throws(()=>x.store.listPendingUsers(helper),e=>e.status===403);
  assert.throws(()=>x.store.reportQueue(helper),e=>e.status===403);
  assert.throws(()=>x.store.reviewQueue(helper),e=>e.status===403);
  assert.throws(()=>x.store.communityReportQueue(helper),e=>e.status===403);
  assert.throws(()=>x.store.copyrightReviewQueue(helper),e=>e.status===403);
  assert.throws(()=>x.store.privacyRequestQueue(helper),e=>e.status===403);
  assert.throws(()=>x.store.resolvePaymentDispute(helper,'unknown-order','approved'),e=>e.status===403);
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'verification_reviewer'}})).status,200);
  assert.equal(x.store.listPendingUsers(helper).length,1);
  assert.throws(()=>x.store.reviewQueue(helper),e=>e.status===403);
  assert.equal(x.store.verifyStudent(helper,x.student.id).id,x.student.id);
  assert.equal((await x.call('admin/governance/roles/assign',{method:'POST',session:x.owner.token,body:{userId:x.secondId,role:'content_moderator'}})).status,200);
  assert.deepEqual(x.store.reviewQueue(helper),[]);
  assert.throws(()=>x.store.privacyRequestQueue(helper),e=>e.status===403);
  assert.throws(()=>x.store.resolvePaymentDispute(helper,'unknown-order','approved'),e=>e.status===403);
 }finally{x.finish();}
});
