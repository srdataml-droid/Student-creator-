import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../packages/content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../packages/payment-core/src/bounded-response.mjs';

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmX0AAAAASUVORK5CYII=','base64');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const buckets=['student-creators-private-identity','student-creators-private-media'];
const fail=code=>Object.assign(new Error(code),{code});
const assert=(ok,code)=>{if(!ok)throw fail(code);};
const safeCode=code=>typeof code==='string'&&/^[A-Z0-9_]{1,80}$/.test(code)?code:'PROVIDER_UNAVAILABLE';

export async function verifyHostedStorage({env=process.env,fetcher=fetch}={}){
 assert(env.STUDENT_CREATORS_STORAGE_ACCEPTANCE_ENABLED==='true','ACCEPTANCE_DISABLED');
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
 assert(cfg,'STAGING_NOT_APPROVED');
 const tokens=[env.STUDENT_CREATORS_STORAGE_TEST_TOKEN_A,env.STUDENT_CREATORS_STORAGE_TEST_TOKEN_B];
 assert(tokens.every(t=>typeof t==='string'&&t.length<=8192&&JWT.test(t))&&tokens[0]!==tokens[1],'TWO_SYNTHETIC_TOKENS_REQUIRED');
 const server=supabaseServerHeaders(cfg.serverKey),anon={apikey:cfg.publishableKey};
 const actors=tokens.map(t=>({...anon,authorization:'Bearer '+t}));
 async function call(path,headers,{method='GET',data,bytes}={}){
  return fetcher(new URL(path,cfg.url),{method,headers:{...headers,...(data?{'content-type':'application/json'}:{}),
   ...(bytes?{'content-type':'image/png','x-upsert':'false'}:{})},...(data?{body:JSON.stringify(data)}:bytes?{body:bytes}:{}),
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 }
 async function json(r){
  return JSON.parse(await readBoundedGatewayResponse(r,32768,()=>fail('INVALID_PROVIDER_RESPONSE')));
 }
 // Check actual signed-in identities, not just a locally decoded JWT. The
 // script accepts only explicitly synthetic example.invalid test accounts.
 const users=await Promise.all(actors.map(async headers=>{
  const r=await call('/auth/v1/user',headers);assert(r.ok,'SYNTHETIC_AUTH_FAILED');
  const user=await json(r);
  assert(UUID.test(user?.id??'')&&typeof user.email==='string'&&/^wk-storage-test-[ab]@example\.invalid$/i.test(user.email)&&
   Boolean(user.email_confirmed_at)&&user.is_anonymous!==true,'SYNTHETIC_ACCOUNT_REQUIRED');
  return user;
 }));
 assert(users[0].id!==users[1].id&&users[0].email.toLowerCase()!==users[1].email.toLowerCase(),'DISTINCT_SYNTHETIC_ACCOUNTS_REQUIRED');
 const runId=randomUUID(),prefix='private/acceptance/'+runId;
 const object=prefix+'/fixture.png';
 const attempted=[object,...['anon','a','b'].map(x=>prefix+'/denied-'+x+'.png')];
 const checks=[];
 const path=(bucket,key,scope='')=>'/storage/v1/object/'+scope+bucket+'/'+key;
 async function denied(r){
  if([401,403,404].includes(r.status))return true;
  if(r.status!==400)return false;
  const d=await json(r).catch(()=>null);
  return ['401','403','404'].includes(String(d?.statusCode??''));
 }
 let failure=null;
 // Record every attempted path before sending any upload; finally cleanup
 // includes writes that unexpectedly succeeded or had ambiguous outcomes.
 try{
  for(const bucket of buckets){
   const put=await call(path(bucket,object),server,{method:'POST',bytes:PNG});
   assert(put.ok,'SERVER_UPLOAD_FAILED');
   const get=await call(path(bucket,object,'authenticated/'),server);
   assert(get.ok,'SERVER_DOWNLOAD_FAILED');
   const reader=get.body?.getReader();assert(reader,'SERVER_DOWNLOAD_FAILED');
   let total=0;const chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;
    assert(total<=PNG.length,'FIXTURE_BYTES_MISMATCH');chunks.push(Buffer.from(value));}}
   finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
   assert(Buffer.concat(chunks).equals(PNG),'FIXTURE_BYTES_MISMATCH');
   checks.push('SERVER_ROUNDTRIP');
   assert(await denied(await call(path(bucket,object,'public/'),anon)),'PUBLIC_URL_ACCESSIBLE');
   checks.push('PUBLIC_URL_DENIED');
   for(const [i,headers] of [anon,...actors].entries()){
    assert(await denied(await call(path(bucket,object,'authenticated/'),headers)),'PRIVATE_DOWNLOAD_ACCESSIBLE');
    assert(await denied(await call(path(bucket,object),headers)),'OBJECT_DOWNLOAD_ACCESSIBLE');
    const list=await call('/storage/v1/object/list/'+bucket,headers,{method:'POST',data:{prefix,limit:10,offset:0}});
    if(list.ok){const rows=await json(list);assert(Array.isArray(rows)&&rows.length===0,'PRIVATE_LIST_ACCESSIBLE');}
    else assert(await denied(list),'PRIVATE_LIST_UNVERIFIED');
    assert(await denied(await call('/storage/v1/object/sign/'+bucket+'/'+object,headers,{method:'POST',data:{expiresIn:60}})),'SIGNED_URL_ACCESSIBLE');
    assert(await denied(await call(path(bucket,attempted[i+1]),headers,{method:'POST',bytes:PNG})),'UNAUTHORIZED_UPLOAD_SUCCEEDED');
    checks.push('ACTOR_DENIALS');
   }
  }
 }catch(e){failure=safeCode(e?.code);}
 // Delete only exact random fixture keys, never accounts, buckets or prefixes.
 // Supabase Storage API performs both object and metadata deletion.
 let cleaned=true;
 for(const bucket of buckets){
  try{
   const r=await call('/storage/v1/object/'+bucket,server,{method:'DELETE',data:{prefixes:attempted}});
   if(!r.ok){cleaned=false;continue;}
   const list=await call('/storage/v1/object/list/'+bucket,server,{method:'POST',data:{prefix,limit:10,offset:0}});
   if(!list.ok){cleaned=false;continue;}
   const rows=await json(list);if(!Array.isArray(rows)||rows.length!==0)cleaned=false;
  }catch{cleaned=false;}
 }
 if(!cleaned)throw fail('FIXTURE_CLEANUP_UNVERIFIED');
 if(failure)throw fail(failure);
 return {status:'passed',buckets:2,actors:3,checks:checks.length,cleanupVerified:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await verifyHostedStorage()));}
 catch(e){console.error(JSON.stringify({status:'failed',code:safeCode(e?.code)}));process.exitCode=1;}
}
