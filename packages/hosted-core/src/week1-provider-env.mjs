/**
 * Week 1 server-only service environment adapter.
 * Accept known Vercel key spellings without exposing secret values in reports.
 * This is configuration validation, NOT a provider connection or hosted runtime.
 * No browser/client bundle may import this module.
 */
const fail=(code)=>Object.assign(new Error(code),{code,status:503});
const isSet=(v)=>typeof v==='string'&&v.trim().length>0;

const bindings=Object.freeze({
  supabaseUrl:['SUPABASE_URL','supabase_url'],
  supabasePublishableKey:['SUPABASE_PUBLISHABLE_KEY','supabase_publishable_key'],
  supabaseSecretKey:['SUPABASE_SECRET_KEY','supabase_secret_key'],
  livekitUrl:['LIVEKIT_URL','livekit_project_url'],
  livekitApiKey:['LIVEKIT_API_KEY','livekit_apikey'],
  resendApiKey:['RESEND_API_KEY','resend_api'],
  paystackTestKey:['PAYSTACK_TEST_SECRET_KEY','paystack_secret_key']
});

function read(env,field){
 const names=bindings[field];
 const found=names.filter(key=>isSet(env[key]));
 if(found.length===0)return null;
 // Duplicate names may exist during migration, but distinct credentials must
 // never silently select the wrong staging project or merchant account.
 if(found.some(key=>env[key].trim()!==env[found[0]].trim()))
  throw fail('CONFLICTING_'+field.replace(/[A-Z]/g,x=>'_'+x).toUpperCase());
 return env[found[0]].trim();
}

function matchSupabaseUrl(value,projectRef){
 if(!value||!/^[a-z0-9]{20}$/.test(String(projectRef||'')))return false;
 try{
  const u=new URL(value);
  return u.protocol==='https:'&&u.hostname===projectRef+'.supabase.co'&&
   u.port===''&&u.username===''&&u.password===''&&
   (u.pathname==='/'||u.pathname==='')&&u.search===''&&u.hash==='';
 }catch{return false;}
}
function matchLivekitUrl(value){
 try{const u=new URL(value);return u.protocol==='wss:'&&!!u.hostname&&
 u.username===''&&u.password===''&&u.hash==='';}catch{return false;}
}

/**
 * For trusted server-side code only. Sensitive properties MUST NOT be
 * serialized into API responses, logs, exception messages or GitHub output.
 * Accepts existing lowercase Vercel spellings and canonical uppercase names.
 * All provider calls must remain individually disabled until verified.
 */
export function resolveWeek1ProviderEnvironment(env={}){
 if(env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.APP_DATA_MODE!=='hosted')
  throw fail('HOSTED_STAGING_NOT_APPROVED');
 if(env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false')
  throw fail('PUBLIC_ENROLLMENT_OR_LIVE_PAYMENT_NOT_DISABLED');
 const supabaseUrl=read(env,'supabaseUrl');
 if(!matchSupabaseUrl(supabaseUrl,env.STUDENT_CREATORS_PROJECT_REF))
  throw fail('SUPABASE_STAGING_PROJECT_MISMATCH');
 const supabasePublishableKey=read(env,'supabasePublishableKey');
 if(!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(supabasePublishableKey||''))
  throw fail('SUPABASE_PUBLISHABLE_KEY_REQUIRED');
 const supabaseSecretKey=read(env,'supabaseSecretKey');
 if(!/^sb_secret_[A-Za-z0-9_-]{12,}$/.test(supabaseSecretKey||''))
  throw fail('SUPABASE_SERVER_SECRET_REQUIRED');
 const livekitUrl=read(env,'livekitUrl');
 if(livekitUrl&&!matchLivekitUrl(livekitUrl))throw fail('LIVEKIT_WSS_URL_REQUIRED');
 const livekitApiKey=read(env,'livekitApiKey');
 const resendApiKey=read(env,'resendApiKey');
 const paystackTestKey=read(env,'paystackTestKey');
 // Never accept live Paystack keys under an ambiguous historical name.
 if(paystackTestKey&&!/^sk_test_[A-Za-z0-9]+$/.test(paystackTestKey))
  throw fail('PAYSTACK_TEST_ONLY');
 // Mux signing aliases are deliberately NOT guessed: some existing Vercel
 // variables mean an API token, some mean a playback JWT key ID/private key.
 return Object.freeze({
  supabase:Object.freeze({url:supabaseUrl,publishableKey:supabasePublishableKey,secretKey:supabaseSecretKey}),
  livekit:Object.freeze({url:livekitUrl,apiKey:livekitApiKey}),
  resend:Object.freeze({apiKey:resendApiKey}),
  paystack:Object.freeze({testKey:paystackTestKey}),
  allowedModes:Object.freeze({registration:false,realPayments:false}),
  muxSigningConfigured:false
 });
}

/** Public-safe metadata only: never includes actual values or provider responses. */
export function inspectWeek1ProviderEnvironment(env={}){
 try{
  const result=resolveWeek1ProviderEnvironment(env);
  return Object.freeze({readyForConnectionTests:true,hostedIntegrationComplete:false,
   safeToEnrollStudents:false,realPaymentsEnabled:false,
   providers:Object.freeze({supabase:true,livekit:Boolean(result.livekit.url&&result.livekit.apiKey),
    resend:Boolean(result.resend.apiKey),paystackTest:Boolean(result.paystack.testKey),muxSigning:false}),
   issues:Object.freeze(['MUX_SIGNING_MAPPING_REQUIRES_VERIFICATION','HOSTED_PROVIDER_CALLS_NOT_YET_TESTED'])});
 }catch(e){return Object.freeze({readyForConnectionTests:false,hostedIntegrationComplete:false,
   safeToEnrollStudents:false,realPaymentsEnabled:false,
   providers:Object.freeze({supabase:false,livekit:false,resend:false,paystackTest:false,muxSigning:false}),
   issues:Object.freeze([e.code||'HOSTED_CONFIG_INVALID'])});}
}
