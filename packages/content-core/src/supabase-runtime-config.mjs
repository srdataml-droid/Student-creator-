/**
 * Server-only Supabase runtime configuration for the Student Creators web app.
 * Supports Vercel's currently configured lowercase aliases. All aliases of
 * one credential must agree; an ambiguous value must never pick a different
 * project or service identity by accident.
 */
function readAlias(env,names) {
  const present=names.filter(k=>typeof env?.[k]==='string'&&env[k].trim().length);
  if(!present.length)return null;
  const selected=env[present[0]].trim();
  if(present.some(k=>env[k].trim()!==selected))throw Error('CONFLICTING_SUPABASE_CONFIGURATION');
  return selected;
}

export function readSupabaseRuntimeConfig(env={}, {server=false}={}) {
  const url=readAlias(env,['SUPABASE_URL','supabase_url']);
  const publishableKey=readAlias(env,['SUPABASE_PUBLISHABLE_KEY','supabase_publishable_key']);
  const serverKey=server?readAlias(env,[
    'SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
    'supabase_secret_key','superbase_secret_key'
  ]):null;
  if(!url||!publishableKey||(server&&!serverKey))return null;
  let parsed;
  try{parsed=new URL(url);}catch{throw Error('INVALID_SUPABASE_URL');}
  // Supabase-managed project only; reject credentials, custom ports, paths,
  // query strings and attacker-controlled alternate destinations.
  if(parsed.protocol!=='https:'||!/^[a-z0-9]{3,}\.supabase\.co$/.test(parsed.hostname)||
     parsed.username||parsed.password||parsed.port||
     !['','/'].includes(parsed.pathname)||parsed.search||parsed.hash)
    throw Error('INVALID_SUPABASE_URL');
  const projectRef=env.STUDENT_CREATORS_PROJECT_REF;
  if(projectRef&&(!/^[a-z0-9]{20}$/.test(projectRef)||parsed.hostname!==projectRef+'.supabase.co'))
    throw Error('SUPABASE_PROJECT_REF_MISMATCH');
  return Object.freeze({url:parsed.origin,publishableKey,...(server?{serverKey}:{})});
}

/** Opaque sb_secret_ keys belong only in apikey, not Authorization: Bearer.
 * Legacy JWT service-role keys are JWTs and may also be sent as a Bearer token.
 * Ref: https://supabase.com/docs/guides/functions/auth-headers
 */
export function supabaseServerHeaders(serverKey) {
  if(typeof serverKey!=='string'||!serverKey.length)throw Error('MISSING_SERVER_KEY');
  return {
    apikey:serverKey,
    ...(serverKey.startsWith('sb_secret_')?{}:{authorization:'Bearer '+serverKey})
  };
}

// Actual app entrypoints require explicit staging approval, the dedicated project,
// and distinct public/server credential types. Legacy JWT role claims here are
// a configuration sanity check only; Supabase verifies their signatures.
const STAGING_REF='jnkqmlbkkvccnxrgkpno';
function credentialRole(key,role){
  if(typeof key!=='string'||key.length>4096)return false;
  if(role==='anon'&&/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key))return true;
  if(role==='service_role'&&/^sb_secret_[A-Za-z0-9_-]{12,}$/.test(key))return true;
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))return false;
  try{
    const p=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));
    return p.role===role&&p.ref===STAGING_REF;
  }catch{return false;}
}
export function readDedicatedSupabaseRuntimeConfig(env={},options={}){
  const live=env.STUDENT_CREATORS_ENVIRONMENT==='production'&&env.STUDENT_CREATORS_PAYSTACK_TEST_ENABLED!=='true';
  const staging=env.STUDENT_CREATORS_STAGING_APPROVED==='true'&&env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED==='false';
  if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_PROJECT_REF!==STAGING_REF||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||!(live||staging))return null;
  const config=readSupabaseRuntimeConfig(env,options);
  if(!config)return null;
  if(!credentialRole(config.publishableKey,'anon')||
     (options.server&&(!credentialRole(config.serverKey,'service_role')||
       config.serverKey===config.publishableKey)))throw Error('INVALID_SUPABASE_CREDENTIAL_ROLE');
  return config;
}
