import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';

test('copyright notice: verified reporter, independent admin takedown, creator appeal and financial noninterference',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'creator-rights-')),path=join(dir,'campus.sqlite');
 const store=openLocalStore(path);
 const pw='Private Synthetic Student Password 2026';
 async function request(route,method='GET',body,session){
  const r=new Request('http://localhost:3000/api/local/'+route,{method,headers:{
   ...(session?{cookie:'campus_local_session='+session}:{}),
   ...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})
  },...(body===undefined?{}:{body:JSON.stringify(body)})});
  const res=await createLocalHandler(store)(r,route.split('/'));
  return {status:res.status,data:await res.json()};
 }
 try{
  store.bootstrapAdmin('operator@copyright.invalid','Private Synthetic Operator Password 2026');
  const admin=store.login('operator@copyright.invalid','Private Synthetic Operator Password 2026');
  const inst=store.createInstitution(admin.user,'Synthetic Copyright University');
  const course=store.createCourse(admin.user,{institutionId:inst.id,code:'COPY101',title:'Rights-cleared Synthetic Content'});
  for(const email of ['creator@copyright.invalid','reporter@copyright.invalid','other@copyright.invalid']){
   const user=store.register({email,password:pw,institutionId:inst.id});store.verifyStudent(admin.user,user.id);
  }
  const creator=store.login('creator@copyright.invalid',pw),reporter=store.login('reporter@copyright.invalid',pw),
   other=store.login('other@copyright.invalid',pw);
  const lesson=store.createDraft(creator.user,{courseId:course.id,title:'Original creator worked explanation',
   description:'Synthetic lesson',previewText:'Original preview',
   lessonText:'An original synthetic worked explanation of a small probability distribution with independent data, assumptions and a complete check of each step. This contains no real school ID, grade or private teaching materials.',
   rightsAttested:true,creationKey:'synthetic-copyright-rights-draft-01'}).lesson.id;
  store.submit(creator.user,lesson);store.review(admin.user,lesson,{decision:'approve',reason:'Approved original teaching work'});
  const statement='I believe this posted lesson duplicates a protected work. Please verify independently and contact the author.';
  const payload={lessonId:lesson,reason:statement};
  assert.equal((await request('me/copyright-claims','POST',payload)).status,401);
  assert.equal((await request('me/copyright-claims','POST',{...payload,reason:'short'},reporter.token)).status,422);
  assert.equal((await request('admin/copyright-claims','GET',undefined,reporter.token)).status,403);
  assert.equal((await request('me/copyright-claims','POST',payload,reporter.token)).status,201);
  const same=await request('me/copyright-claims','POST',payload,reporter.token);
  assert.equal(same.status,200);const caseId=same.data.claim.caseId;
  assert.equal((await request('me/copyright-claims','GET',undefined,other.token)).data.claims.length,0);
  const queue=await request('admin/copyright-claims','GET',undefined,admin.token);
  assert.equal(queue.data.claims.length,1);
  assert.equal(queue.data.claims[0].caseId,caseId);
  assert.equal((await request('admin/copyright-claims/'+caseId+'/resolve','POST',{decision:'take_down',note:'Independent review needed'},reporter.token)).status,403);
  assert.equal((await request('lessons/'+lesson,'GET',undefined,reporter.token)).status,200);
  const resolved=await request('admin/copyright-claims/'+caseId+'/resolve','POST',{decision:'take_down',note:'Synthetic review determined content should be hidden'},admin.token);
  assert.equal(resolved.status,200);
  assert.equal(resolved.data.result.financialReviewRequired,true);
  assert.equal((await request('lessons/'+lesson,'GET',undefined,reporter.token)).status,404);
  assert.equal((await request('admin/copyright-claims/'+caseId+'/resolve','POST',{decision:'take_down',note:'Repeated review'},admin.token)).status,404);
  const appealBody={reason:'I own and created the original lesson. Please independently investigate this synthetic dispute before reconsideration.'};
  assert.equal((await request('copyright-claims/'+caseId+'/appeal','POST',appealBody,other.token)).status,404);
  assert.equal((await request('copyright-claims/'+caseId+'/appeal','POST',appealBody,creator.token)).status,201);
  assert.equal((await request('copyright-claims/'+caseId+'/appeal','POST',appealBody,creator.token)).status,200);
  assert.equal((await request('lessons/'+lesson,'GET',undefined,reporter.token)).status,404);
  assert.equal((await request('me/privacy-requests','POST',{kind:'account_deletion'},creator.token)).status,201);
  assert.equal((await request('me/privacy-requests','POST',{kind:'account_deletion'},creator.token)).status,200);
  assert.equal((await request('me/privacy-requests','POST',{kind:'verification_evidence_deletion'},creator.token)).status,201);
  assert.equal((await request('me/privacy-requests','GET',undefined,other.token)).data.requests.length,0);
  assert.equal((await request('admin/privacy-requests','GET',undefined,reporter.token)).status,403);
  assert.equal((await request('admin/privacy-requests','GET',undefined,admin.token)).data.requests.length,2);
  // Requests never silently delete an account or change payment/entitlement records.
  assert.ok(store.getSession(creator.token));
  const db=new DatabaseSync(path);
  try{
   assert.equal(db.prepare('SELECT status FROM lessons WHERE id=?').get(lesson).status,'taken_down');
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM copyright_appeals').get().n,1);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM privacy_requests').get().n,2);
  }finally{db.close();}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
