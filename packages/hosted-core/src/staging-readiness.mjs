/**
 * Staging readiness validation; NOT an operational hosted backend.
 * This file never contacts Supabase, provisions resources or exposes secrets.
 */
const invalid=(code)=>Object.assign(new Error(code),{code,status:503});
const REF=/^[a-z0-9]{20}$/;
const BUCKET=/^[a-z0-9][a-z0-9_-]{2,62}$/;
const expectedMedia='student-creators-private-media';
const expectedIdentity='student-creators-private-identity';

export function checkStudentCreatorsStaging(env={}){
 const issues=[];
 function requireIt(ok,code){if(!ok)issues.push(code);}
 requireIt(env.STUDENT_CREATORS_STAGING_APPROVED==='true','STAGING_APPROVAL_REQUIRED');
 requireIt(env.APP_DATA_MODE==='hosted','HOSTED_MODE_REQUIRED');
 const ref=env.STUDENT_CREATORS_PROJECT_REF;
 requireIt(typeof ref==='string'&&REF.test(ref),'STAGING_PROJECT_REF_REQUIRED');
 const url=env.STUDENT_CREATORS_SUPABASE_URL;
 let parsed=null;
 try{parsed=new URL(url);}catch{}
 requireIt(parsed?.protocol==='https:'&&parsed.port===''&&parsed.username===''&&
  parsed.password===''&&parsed.pathname==='/'&&parsed.search===''&&parsed.hash===''&&
  parsed.hostname===String(ref)+'.supabase.co','STAGING_URL_PROJECT_MISMATCH');
 requireIt(env.STUDENT_CREATORS_PRIVATE_MEDIA_BUCKET===expectedMedia,'PRIVATE_MEDIA_BUCKET_REQUIRED');
 requireIt(env.STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET===expectedIdentity,'PRIVATE_IDENTITY_BUCKET_REQUIRED');
 requireIt(env.STUDENT_CREATORS_PRIVATE_MEDIA_BUCKET!==env.STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET,
  'BUCKET_ISOLATION_REQUIRED');
 requireIt(BUCKET.test(String(env.STUDENT_CREATORS_PRIVATE_MEDIA_BUCKET||''))&&
  BUCKET.test(String(env.STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET||'')),'UNSAFE_BUCKET_NAME');
 requireIt(env.STUDENT_CREATORS_AUTH_EMAIL_CONFIRMATION==='required','EMAIL_CONFIRMATION_REQUIRED');
 requireIt(env.STUDENT_CREATORS_IDENTITY_DATA_POLICY_APPROVED==='true','IDENTITY_PRIVACY_APPROVAL_REQUIRED');
 requireIt(env.STUDENT_CREATORS_STAGING_BACKUP_TARGET_ISOLATED==='true','ISOLATED_RESTORE_TARGET_REQUIRED');
 requireIt(env.STUDENT_CREATORS_PUBLIC_REGISTRATION==='false','PUBLIC_ENROLLMENT_DISABLED_REQUIRED');
 requireIt(env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED==='false','REAL_PAYMENTS_DISABLED_REQUIRED');
 // A hard gate for the founder's one-person plan; new hosted Auth must
 // implement its own server-side invitation atomicity rather than reusing SQLite.
 requireIt(env.STUDENT_CREATORS_PILOT_SEATS==='1','ONE_STUDENT_INVITE_GATE_REQUIRED');
 requireIt(typeof env.STUDENT_CREATORS_PILOT_INVITE_SECRET==='string'&&
  /^[A-Za-z0-9_-]{32,128}$/.test(env.STUDENT_CREATORS_PILOT_INVITE_SECRET),
  'PRIVATE_HOSTED_INVITE_SECRET_REQUIRED');
 // No loose SUPABASE_URL fallback or shared project selection. The browser
 // may use only a publishable key, never service_role/secret credentials.
 const publicKey=env.STUDENT_CREATORS_PUBLISHABLE_KEY;
 requireIt(typeof publicKey==='string'&&/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(publicKey),
  'PUBLISHABLE_KEY_REQUIRED');
 // Do not interpret a valid-looking config as deployed infrastructure.
 return Object.freeze({
  readyForProvisioningReview:issues.length===0,
  safeToOpenRealEnrollment:false,
  hostedBackendImplemented:false,
  privateStorageVerified:false,
  actualRestoreTested:false,
  issues:Object.freeze(issues),
  projectRefPresent:Boolean(ref&&REF.test(ref))
 });
}
export function requireStagingReadiness(env){
 const result=checkStudentCreatorsStaging(env);
 if(!result.readyForProvisioningReview)throw invalid('STUDENT_CREATORS_STAGING_NOT_APPROVED');
 return result;
}
