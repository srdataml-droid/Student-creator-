import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStudentCreatorsStaging,requireStagingReadiness} from '../src/staging-readiness.mjs';
const syntheticRef='abcdefghij1234567890';
const base={
 STUDENT_CREATORS_STAGING_APPROVED:'true',APP_DATA_MODE:'hosted',
 STUDENT_CREATORS_PROJECT_REF:syntheticRef,STUDENT_CREATORS_SUPABASE_URL:'https://'+syntheticRef+'.supabase.co/',
 STUDENT_CREATORS_PRIVATE_MEDIA_BUCKET:'student-creators-private-media',
 STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET:'student-creators-private-identity',
 STUDENT_CREATORS_AUTH_EMAIL_CONFIRMATION:'required',
 STUDENT_CREATORS_IDENTITY_DATA_POLICY_APPROVED:'true',
 STUDENT_CREATORS_STAGING_BACKUP_TARGET_ISOLATED:'true',
 STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',
 STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',
 STUDENT_CREATORS_PILOT_SEATS:'1',
 STUDENT_CREATORS_PILOT_INVITE_SECRET:'synthetic_private_hosted_invite_abcdefghijklmnop',
 STUDENT_CREATORS_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_ONLY_TEST_KEY_abcdefghijklmnop'
};
test('staging configuration gate never treats valid configuration as deployed or open for real students',()=>{
 const r=checkStudentCreatorsStaging(base);
 assert.equal(r.readyForProvisioningReview,true);
 assert.equal(r.safeToOpenRealEnrollment,false);
 assert.equal(r.hostedBackendImplemented,false);
 assert.equal(r.privateStorageVerified,false);
 assert.equal(r.actualRestoreTested,false);
 assert.deepEqual(r.issues,[]);
 assert.equal(JSON.stringify(r).includes(base.STUDENT_CREATORS_PILOT_INVITE_SECRET),false);
 assert.equal(JSON.stringify(r).includes(base.STUDENT_CREATORS_PUBLISHABLE_KEY),false);
 assert.equal(requireStagingReadiness(base).readyForProvisioningReview,true);
});
test('staging gate forbids other projects, insecure endpoints, public buckets, no consent, no invite, payments enabled',()=>{
 const bad=[
  {},{STUDENT_CREATORS_STAGING_APPROVED:'false'},
  {STUDENT_CREATORS_SUPABASE_URL:'https://anotherprojectref123.supabase.co/'},
  {STUDENT_CREATORS_SUPABASE_URL:'http://'+syntheticRef+'.supabase.co/'},
  {STUDENT_CREATORS_SUPABASE_URL:'https://'+syntheticRef+'.supabase.co/evil'},
  {STUDENT_CREATORS_PRIVATE_MEDIA_BUCKET:'public'},
  {STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET:'public'},
  {STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET:'student-creators-private-media'},
  {STUDENT_CREATORS_AUTH_EMAIL_CONFIRMATION:'optional'},
  {STUDENT_CREATORS_IDENTITY_DATA_POLICY_APPROVED:'false'},
  {STUDENT_CREATORS_STAGING_BACKUP_TARGET_ISOLATED:'false'},
  {STUDENT_CREATORS_PUBLIC_REGISTRATION:'true'},
  {STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'},
  {STUDENT_CREATORS_PILOT_SEATS:'100'},
  {STUDENT_CREATORS_PILOT_INVITE_SECRET:'short'},
  {STUDENT_CREATORS_PUBLISHABLE_KEY:'service_role'}
 ];
 for(const delta of bad){
  const candidate=delta===bad[0]?delta:{...base,...delta};
  const result=checkStudentCreatorsStaging(candidate);
  assert.equal(result.readyForProvisioningReview,false,JSON.stringify(delta));
  assert.ok(result.issues.length>0);
  assert.throws(()=>requireStagingReadiness(candidate),{code:'STUDENT_CREATORS_STAGING_NOT_APPROVED'});
 }
});
