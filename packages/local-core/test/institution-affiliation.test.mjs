import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openLocalStore} from '../src/store.mjs';
import {createLocalHandler} from '../src/http.mjs';
import {institutionalSubjectDigest,makeSyntheticInstitutionProvider} from '../../identity-core/src/institutions.mjs';

const privateKey='synthetic_only_institution_HMAC_secret_abcdefghijklmnopqrstuvwxyz';
const password='Synthetic Original Student Password 2026';
const textBody='This is an original, independently written explanation about counting sets. I define a simple example, explain the method with distinct steps, and independently check the result without copying another person or a school examination.';

test('pseudonymous institutional proof must be authorized, manual-reviewed and current for creator/media access',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'institution-integration-'));
 let store=openLocalStore(join(dir,'institution.sqlite'));
 const run=async(route,method='GET',body,token)=>{
  const response=await createLocalHandler(store)(new Request('http://localhost:3000/api/local/'+route,{
   method,headers:{...(token?{cookie:'campus_local_session='+token}:{}),...(method==='POST'?{origin:'http://localhost:3000','content-type':'application/json'}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  }),route.split('/'));
  return {status:response.status,data:await response.json()};
 };
 try{
  store.bootstrapAdmin('operator@synthetic.invalid','Synthetic Moderator Password 2026');
  const admin=store.login('operator@synthetic.invalid','Synthetic Moderator Password 2026');
  const institution=store.createInstitution(admin.user,'Synthetic Institution for Authorized Verification');
  const otherInstitution=store.createInstitution(admin.user,'Different Synthetic Institution');
  const course=store.createCourse(admin.user,{institutionId:institution.id,code:'SYN101',title:'Original Identity Engineering'});
  const subject=institutionalSubjectDigest(privateKey,institution.id,'STUDENT-001');
  const config={institutionId:institution.id,providerId:'synthetic_identity_approved',kind:'synthetic'};
  const studentA=store.register({email:'student-a@synthetic.invalid',password,institutionId:institution.id});
  const studentB=store.register({email:'student-b@synthetic.invalid',password,institutionId:institution.id});
  const unrelated=store.register({email:'other-campus@synthetic.invalid',password,institutionId:otherInstitution.id});
  const a=store.login('student-a@synthetic.invalid',password);
  const b=store.login('student-b@synthetic.invalid',password);
  const c=store.login('other-campus@synthetic.invalid',password);
  assert.equal((await run('admin/institution-integrations','POST',config,a.token)).status,403);
  assert.equal((await run('admin/institution-integrations','POST',{...config,secret:privateKey},admin.token)).status,400);
  assert.equal((await run('admin/institution-integrations','POST',config,admin.token)).status,201);
  assert.equal((await run('admin/institution-integrations/synthetic_identity_approved','GET',undefined,a.token)).status,403);
  assert.equal((await run('admin/institution-integrations/synthetic_identity_approved/enable-synthetic','POST',{},a.token)).status,403);
  assert.equal((await run('admin/institution-integrations/synthetic_identity_approved/enable-synthetic','POST',{},admin.token)).status,200);
  const registry=await run('admin/institution-integrations/synthetic_identity_approved','GET',undefined,admin.token);
  assert.equal(registry.data.integration.enabled,true);
  assert.equal(JSON.stringify(registry.data).includes(privateKey),false);
  const fake={institutionId:institution.id,providerId:config.providerId,subjectDigest:subject,eligible:true,role:'student',state:'active'};
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,fake),{code:'UNVERIFIED_INSTITUTION_EVIDENCE'});
  const roster=new Map([[subject,{role:'student',state:'active'}]]);
  let now=Math.floor(Date.now()/1000)-10;
  const provider=makeSyntheticInstitutionProvider({config,secret:privateKey,roster,clock:()=>now});
  const proof=await provider.verify({subjectDigest:subject});
  assert.equal(proof.eligible,true);
  const row=store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,proof);
  assert.equal(row.eligible,true);
  assert.equal(row.requiresIndependentManualApproval,true);
  assert.equal(store.getSession(a.token).verifiedAt,null);
  assert.equal((await run('me/institution-affiliation','GET',undefined,a.token)).data.affiliation.classification,'student');
  assert.equal((await run('me/institution-affiliation','GET',undefined,b.token)).data.affiliation.state,'manual_fallback');
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(admin.user,studentB.id,proof),{code:'DUPLICATE_INSTITUTIONAL_IDENTITY'});
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(admin.user,unrelated.id,proof),{code:'INSTITUTION_MISMATCH'});
  const draftPayload={courseId:course.id,title:'Verified institutional original explanation',description:'Original synthetic',
   previewText:'Independent explanation',lessonText:textBody,rightsAttested:true,creationKey:'identity-contract-draft-001'};
  assert.throws(()=>store.createDraft(a.user,draftPayload),{code:'VERIFICATION_REQUIRED'});
  store.verifyStudent(admin.user,studentA.id);
  const verifiedActor=store.getSession(a.token);
  const id=store.createDraft(verifiedActor,draftPayload).lesson.id;
  assert.ok(id);
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(a.user,studentA.id,proof),{code:'ADMIN_REQUIRED'});
  // A graduate, alumni or lecturer is not an active verified student.
  now++;
  roster.set(subject,{role:'student',state:'graduated'});
  const graduated=await provider.verify({subjectDigest:subject});
  store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,graduated);
  assert.equal(store.getSession(a.token).verifiedAt,null);
  store.close();store=openLocalStore(join(dir,'institution.sqlite'));
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,proof),{code:'INSTITUTION_PROOF_REPLAY'});
  const historical=makeSyntheticInstitutionProvider({config,secret:privateKey,roster:new Map([[subject,{role:'student',state:'active'}]]),clock:()=>now-1});
  const stale=await historical.verify({subjectDigest:subject});
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,stale),{code:'STALE_INSTITUTION_PROOF'});
  assert.throws(()=>store.createDraft(verifiedActor,{...draftPayload,creationKey:'identity-contract-draft-002'}),{code:'VERIFICATION_REQUIRED'});
  assert.throws(()=>store.verifyStudent(admin.user,studentA.id),{code:'AFFILIATION_NOT_ELIGIBLE'});
  const appeal=await run('me/verification-appeals','POST',{reason:'My institution enrollment classification appears incorrect. Please review my eligibility.'},a.token);
  assert.equal(appeal.status,201);
  assert.equal((await run('me/verification-appeals','POST',{reason:'My institution enrollment classification appears incorrect. Please review my eligibility.'},a.token)).status,200);
  assert.equal((await run('me/verification-appeals','GET',undefined,b.token)).data.appeals.length,0);
  assert.equal((await run('admin/verification-appeals/'+appeal.data.appeal.caseId,'POST',{decision:'review_requested',note:'Manual institution follow-up required'},a.token)).status,403);
  const reviewed=await run('admin/verification-appeals/'+appeal.data.appeal.caseId,'POST',{decision:'review_requested',note:'Manual institution follow-up required'},admin.token);
  assert.equal(reviewed.status,200);
  assert.equal(reviewed.data.appeal.eligibilityUnchanged,true);
  assert.equal(store.getSession(a.token).verifiedAt,null);
  now++;
  roster.set(subject,{role:'lecturer',state:'active'});
  const lecturer=await provider.verify({subjectDigest:subject});
  store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,lecturer);
  assert.equal(store.getSession(a.token).verifiedAt,null);
  roster.set(subject,{role:'student',state:'active'});
  const sameSecond=await provider.verify({subjectDigest:subject});
  assert.throws(()=>store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,sameSecond),{code:'STALE_INSTITUTION_PROOF'});
  now++;
  store.recordVerifiedInstitutionAffiliation(admin.user,studentA.id,await provider.verify({subjectDigest:subject}));
  assert.ok(store.getSession(a.token).verifiedAt);
  const restConfig={institutionId:institution.id,providerId:'restricted_live_university',kind:'rest',
   issuer:'https://verify.university.example',audience:'student-creators',endpoint:'https://verify.university.example/student'};
  store.addInstitutionIntegration(admin.user,restConfig);
  assert.throws(()=>store.enableSyntheticInstitution(admin.user,restConfig.providerId),{code:'INSTITUTION_AUTHORIZATION_REQUIRED'});
  store.disableInstitutionIntegration(admin.user,config.providerId);
  assert.equal(store.getSession(a.token).verifiedAt,null);
  store.enableSyntheticInstitution(admin.user,config.providerId);
  assert.equal(store.getSession(a.token).verifiedAt,null,'reenabling provider does not revive old affiliation');
  assert.equal((await run('me/institution-affiliation','GET',undefined,c.token)).data.affiliation.state,'manual_fallback');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
