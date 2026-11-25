import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {readSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {createResendTransport} from './resend-transport.mjs';
const MAX=65536,REF='jnkqmlbkkvccnxrgkpno';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=()=>new Error('Email hook unavailable');
const hash=s=>createHash('sha256').update(s).digest('hex');
const reply=status=>Response.json(status===200?{}:{error:{http_code:status,message:'Email delivery unavailable'}},{status,headers:{'cache-control':'no-store'}});
const actions={signup:['Verify your email','email verification'],invite:['Your private student invitation','invitation'],recovery:['Reset your password','password recovery']};
async function raw(request){
 const n=request.headers.get('content-length');if(n!==null&&(!/^\d+$/.test(n)||Number(n)>MAX))throw invalid();
 const reader=request.body?.getReader();if(!reader)throw invalid();
 const parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
 if(size>MAX){void reader.cancel().catch(()=>{});throw invalid();}parts.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 return Buffer.concat(parts,size);
}
function decodeSecret(secret){
 if(typeof secret!=='string'||!/^v1,whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw invalid();
 const key=Buffer.from(secret.slice('v1,whsec_'.length),'base64');
 if(key.length<32||key.length>128)throw invalid();return key;
}
export function verifySupabaseEmailHook({bytes,headers,secret,now=Math.floor(Date.now()/1000)}){
 const id=headers.get('webhook-id'),ts=headers.get('webhook-timestamp'),sig=headers.get('webhook-signature');
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX||!/^[-_A-Za-z0-9]{6,128}$/.test(id??'')||
 !/^\d{10,11}$/.test(ts??'')||Math.abs(now-Number(ts))>300||typeof sig!=='string'||sig.length>2048)throw invalid();
 const expected=createHmac('sha256',decodeSecret(secret)).update(id+'.'+ts+'.').update(bytes).digest();
 const verified=sig.split(/\s+/).some(part=>{
  if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(part))return false;
  const candidate=Buffer.from(part.slice(3),'base64');
  return candidate.length===expected.length&&timingSafeEqual(candidate,expected);
 });
 if(!verified)throw invalid();
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function message(payload,{recipient,origin}){
 const email=payload?.user?.email,action=payload?.email_data?.email_action_type;
 const otp=payload?.email_data?.token,tokenHash=payload?.email_data?.token_hash;
 if(typeof email!=='string'||email.toLowerCase()!==recipient||!Object.hasOwn(actions,action)||
 !/^\d{6,10}$/.test(otp??'')||!/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash??''))throw invalid();
 const [subject,purpose]=actions[action];
 // Only the code is sent; no credential in a clickable URL or tracking link.
 const text='Your Worthkind Student Creators '+purpose+' code is: '+otp+'\n\nOpen '+origin+'/auth/confirm and enter the code. Never share it. If you did not request this, ignore this email.';
 const key=hash(action+'\0'+tokenHash);
 const digest=hash(JSON.stringify({email:recipient,subject,text}));
 return {to:recipient,subject,text,key,digest,idempotencyKey:'student-auth/'+key};
}
export function createSupabaseAuthEmailHandler({secret,recipient,origin,store,transport,now=()=>Math.floor(Date.now()/1000)}={}){
 return async request=>{
  if(request.method!=='POST')return reply(405);
  let msg;
  try{msg=message(verifySupabaseEmailHook({bytes:await raw(request),headers:request.headers,secret,now:now()}),{recipient,origin});}
  catch{return reply(400);}
  try{
   const claim=await store.claim({key:msg.key,digest:msg.digest});
   if(claim?.status==='duplicate')return reply(200);
   if(claim?.status==='collision'||claim?.status==='invalid')return reply(409);
   if(claim?.status==='limited')return reply(429);
   if(claim?.status!=='claimed'||!UUID.test(claim.leaseId??''))return reply(503);
   let result;
   try{result=await transport.send(msg);}catch{
    await store.finish({key:msg.key,leaseId:claim.leaseId,providerId:null}).catch(()=>{});
    return reply(503);
   }
   if(await store.finish({key:msg.key,leaseId:claim.leaseId,providerId:result.id})!==true)return reply(503);
   return reply(200);
  }catch{return reply(503);}
 };
}
function readAlias(env,names){
 const v=names.map(k=>env[k]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim());
 if(v.some(x=>x!==v[0]))throw invalid();return v[0];
}
export function buildSupabaseAuthEmailHook({getEnv=()=>process.env,fetcher=fetch}={}){
 return async request=>{
  try{
   const env=getEnv();
   if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.STUDENT_CREATORS_PROJECT_REF!==REF||
    env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||
    env.STUDENT_CREATORS_AUTH_EMAIL_ENABLED!=='true'||env.STUDENT_CREATORS_PILOT_SEATS!=='1')throw invalid();
   const cfg=readSupabaseRuntimeConfig(env,{server:true});
   if(!cfg||cfg.url!=='https://'+REF+'.supabase.co')throw invalid();
   const origin=env.STUDENT_CREATORS_AUTH_ORIGIN,parsed=new URL(origin);
   if(parsed.origin!==origin||parsed.protocol!=='https:'||parsed.username||parsed.password)throw invalid();
   const recipient=String(env.STUDENT_CREATORS_PILOT_EMAIL??'').trim().toLowerCase();
   const secret=env.SUPABASE_AUTH_EMAIL_HOOK_SECRET;decodeSecret(secret);
   const transport=createResendTransport({apiKey:readAlias(env,['RESEND_API_KEY','resend_api']),
    fromEmail:readAlias(env,['RESEND_FROM_EMAIL','resend_from_email']),allowedRecipients:[recipient],fetcher});
   const rpc=async(name,body)=>{
    const r=await fetcher(new URL('/rest/v1/rpc/'+name,cfg.url),{method:'POST',
     headers:{...supabaseServerHeaders(cfg.serverKey),'content-type':'application/json'},body:JSON.stringify(body),
     redirect:'error',cache:'no-store',signal:AbortSignal.timeout(1200)});
    if(!r.ok)throw invalid();return r.json();
   };
   const store={claim:({key,digest})=>rpc('claim_auth_email_delivery',{_key:key,_digest:digest}),
    finish:({key,leaseId,providerId})=>rpc('finish_auth_email_delivery',{_key:key,_lease:leaseId,_provider_id:providerId})};
   return await createSupabaseAuthEmailHandler({secret,recipient,origin,store,transport})(request);
  }catch{return reply(503);}
 };
}
