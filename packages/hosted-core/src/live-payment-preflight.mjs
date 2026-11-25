import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
import {readSupabaseRuntimeConfig} from '../../content-core/src/supabase-runtime-config.mjs';

const STAGING='jnkqmlbkkvccnxrgkpno';
const fail=code=>Object.assign(new Error(code),{code});
const originCheck=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password;}catch{return false;}};
function role(key,expected,ref){
 if(typeof key!=='string'||key.length>4096)return false;
 if(expected==='anon'&&/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key))return true;
 if(expected==='service_role'&&/^sb_secret_[A-Za-z0-9_-]{12,}$/.test(key))return true;
 if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key))return false;
 try{const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));return claims.role===expected&&claims.ref===ref;}catch{return false;}
}
export function readLivePaymentConfiguration(env=process.env){
 const ref=env.STUDENT_CREATORS_PRODUCTION_PROJECT_REF;
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_ENVIRONMENT!=='production'||!(/^[a-z0-9]{20}$/).test(ref??'')||ref===STAGING||env.STUDENT_CREATORS_PROJECT_REF!==ref||env.STUDENT_CREATORS_STAGING_APPROVED==='true'||env.STUDENT_CREATORS_PAYSTACK_TEST_ENABLED==='true')throw fail('ISOLATED_PRODUCTION_REQUIRED');
 const cfg=readSupabaseRuntimeConfig(env,{server:true});
 if(!cfg||cfg.url!=='https://'+ref+'.supabase.co'||!role(cfg.publishableKey,'anon',ref)||!role(cfg.serverKey,'service_role',ref)||cfg.publishableKey===cfg.serverKey)throw fail('PRODUCTION_DATABASE_CONFIGURATION');
 const key=env.PAYSTACK_LIVE_SECRET_KEY;
 if(typeof key!=='string'||!/^sk_live_[A-Za-z0-9]+$/.test(key)||env.PAYSTACK_TEST_SECRET_KEY||env.paystack_secret_key&&env.paystack_secret_key!==key)throw fail('LIVE_KEY_REQUIRED');
 if(!originCheck(env.STUDENT_CREATORS_PAYSTACK_ORIGIN)||env.STUDENT_CREATORS_DISTRIBUTION_CHANNEL!=='independent_web')throw fail('LIVE_WEB_ORIGIN_REQUIRED');
 const signing=env.PAYSTACK_LIVE_WEBHOOK_SIGNING_SECRET,id=env.PAYSTACK_LIVE_WEBHOOK_KEY_ID;
 if(!/^whsec_[A-Za-z0-9_-]{4,256}$/.test(signing??'')||!/^whk_[A-Za-z0-9_-]{3,80}$/.test(id??'')||signing===env.PAYSTACK_WEBHOOK_SIGNING_SECRET)throw fail('SEPARATE_LIVE_WEBHOOK_REQUIRED');
 return {ref,key,config:cfg,origin:env.STUDENT_CREATORS_PAYSTACK_ORIGIN};
}
// A read-only credential check, not a payment, refund, transfer, account creation,
// or proof of approved business status. Never return provider records or secrets.
export async function checkLivePaymentProvider({env=process.env,fetcher=fetch}={}){
 const {key}=readLivePaymentConfiguration(env);
 let response,body;
 try{
  response=await fetcher('https://api.paystack.co/transaction?perPage=1&page=1',{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw fail('LIVE_PROVIDER_DENIED');
  body=JSON.parse(await readBoundedGatewayResponse(response,262144,()=>fail('LIVE_PROVIDER_RESPONSE_INVALID')));
 }catch(e){throw fail(e?.code==='LIVE_PROVIDER_DENIED'?'LIVE_PROVIDER_DENIED':'LIVE_PROVIDER_UNAVAILABLE');}
 if(body?.status!==true||!Array.isArray(body.data)||body.data.length>1||body.data.some(row=>row?.domain!=='live'))throw fail('LIVE_PROVIDER_RESPONSE_INVALID');
 return {liveCredentialAccepted:true,chargeInitiated:false,checkoutEnabled:false,commercialActivationVerified:false};
}
