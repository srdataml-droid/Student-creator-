import {createHash} from 'node:crypto';
import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {readSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';

const REF='jnkqmlbkkvccnxrgkpno', BUCKET='student-creators-private-identity';
export const IDENTITY_MAX_BYTES=4194304;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ext={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'};
const bad=(status,code)=>Object.assign(new Error(code),{status,code});
const unavailable=()=>bad(503,'IDENTITY_STORAGE_UNAVAILABLE');
const json=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function readBoundedIdentityBytes(source){
 const length=source.headers.get('content-length');
 if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>IDENTITY_MAX_BYTES))
  throw bad(413,'IDENTITY_FILE_TOO_LARGE');
 const reader=source.body?.getReader();if(!reader)throw bad(400,'IDENTITY_FILE_REQUIRED');
 const chunks=[];let total=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>IDENTITY_MAX_BYTES){await reader.cancel();throw bad(413,'IDENTITY_FILE_TOO_LARGE');}
   chunks.push(Buffer.from(value));}
 }finally{reader.releaseLock();}
 return Buffer.concat(chunks,total);
}
function validBytes(bytes,mime){
 if(bytes.length<8||!Object.hasOwn(ext,mime))return false;
 // Preliminary type check only: not a parser, malware verdict, or scan.
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
 return bytes.subarray(0,5).toString('ascii')==='%PDF-';
}
function validateObject(object,owner,request,mime){
 if(!object||!UUID.test(object.id??'')||!UUID.test(owner??'')||!UUID.test(request??'')||!Object.hasOwn(ext,mime))
  throw unavailable();
 const expected='private/'+owner+'/'+request+'/'+object.id+'.'+ext[mime];
 if(object.objectKey!==expected)throw unavailable();
 return expected;
}
export function createIdentityEvidenceHandler({auth,store,storage}={}){
 return async (request,{requestId}={})=>{
  if(!UUID.test(requestId??''))return json(404,{error:'EVIDENCE_NOT_FOUND'});
  if(!['GET','POST'].includes(request.method))return json(405,{error:'METHOD_NOT_ALLOWED'});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return json(401,{error:'AUTH_REQUIRED'});
  try{
   const user=await auth.getUser(token);
   if(!UUID.test(user?.id??''))return json(401,{error:'AUTH_REQUIRED'});
   if(request.method==='GET'){
    const object=await store.review({actor:user.id,requestId});
    if(!object)return json(404,{error:'EVIDENCE_NOT_FOUND'});
    const key=validateObject(object,object.ownerId,requestId,object.mime);
    const bytes=await storage.read(key);
    if(!Buffer.isBuffer(bytes)||bytes.length!==object.bytes||sha256(bytes)!==object.digest)throw unavailable();
    return new Response(bytes,{status:200,headers:{'content-type':'application/octet-stream',
     'content-disposition':'attachment; filename="student-identity.'+ext[object.mime]+'"',
     'cache-control':'private, no-store','x-content-type-options':'nosniff',
     'content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer'}});
   }
   const mime=(request.headers.get('content-type')??'').toLowerCase();
   if(!Object.hasOwn(ext,mime))return json(415,{error:'IDENTITY_FILE_TYPE_INVALID'});
   const bytes=await readBoundedIdentityBytes(request);
   if(!validBytes(bytes,mime))return json(422,{error:'IDENTITY_FILE_TYPE_INVALID'});
   const digest=sha256(bytes);
   const reserved=await store.reserve({owner:user.id,requestId,mime,bytes:bytes.length,digest});
   if(!reserved)return json(404,{error:'EVIDENCE_NOT_FOUND'});
   if(reserved.conflict===true)return json(409,{error:'EVIDENCE_ALREADY_RESERVED'});
   const key=validateObject(reserved,user.id,requestId,mime);
   if(reserved.state==='reserved'){
    await storage.writeImmutable(key,mime,bytes,digest);
    if(await store.markUploaded({owner:user.id,requestId,uploadId:reserved.id,digest})!==true)throw unavailable();
   }else if(!['quarantined','clean','malicious','inconclusive'].includes(reserved.state))throw unavailable();
   // Do not expose path, scan details, or reviewer decision; no automatic approval.
   return json(202,{received:true,uploadId:reserved.id});
  }catch(e){
   const known=['IDENTITY_FILE_TOO_LARGE','IDENTITY_FILE_REQUIRED'].includes(e?.code);
   return json(known?e.status:503,{error:known?e.code:'IDENTITY_STORAGE_UNAVAILABLE'});
  }
 };
}
export function createPrivateIdentityProvider({url,serverKey,fetcher=fetch}){
 if(url!=='https://'+REF+'.supabase.co'||!serverKey)throw unavailable();
 const headers=supabaseServerHeaders(serverKey);
 async function rpc(name,body){
  const response=await fetcher(new URL('/rest/v1/rpc/'+name,url),{
   method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body),
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw unavailable();return response.json();
 }
 function objectUrl(key,read=false){
  if(typeof key!=='string'||!/^private\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|pdf)$/i.test(key))
   throw unavailable();
  return new URL('/storage/v1/object/'+(read?'authenticated/':'')+BUCKET+'/'+key,url);
 }
 async function read(key){
  const r=await fetcher(objectUrl(key,true),{method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw unavailable();return readBoundedIdentityBytes(r);
 }
 return {
  store:{
   reserve:({owner,requestId,mime,bytes,digest})=>rpc('reserve_private_identity_upload',{_owner:owner,_request:requestId,_mime:mime,_bytes:bytes,_digest:digest}),
   markUploaded:({owner,requestId,uploadId,digest})=>rpc('mark_private_identity_uploaded',{_owner:owner,_request:requestId,_upload:uploadId,_digest:digest}),
   review:({actor,requestId})=>rpc('get_private_identity_review_object',{_actor:actor,_request:requestId}),
   recordScan:({uploadId,digest,verdict,scanner})=>rpc('record_private_identity_scan',{_upload:uploadId,_digest:digest,_verdict:verdict,_scanner:scanner})
  },
  storage:{
   read,
   async writeImmutable(key,mime,bytes,digest){
    const r=await fetcher(objectUrl(key),{method:'POST',headers:{...headers,'content-type':mime,'x-upsert':'false','cache-control':'no-store'},
      body:bytes,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(r.ok)return;
    // Supabase can report an existing immutable object as 400 or 409.
    // Verify full content before treating a retry as the prior successful upload.
    if(![400,409].includes(r.status))throw unavailable();
    const existing=await read(key);
    if(existing.length!==bytes.length||sha256(existing)!==digest)throw unavailable();
   }
  }
 };
}
export function buildIdentityEvidenceRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async (request,context)=>{
  try{
   const env=getEnv();
   if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||
    env.STUDENT_CREATORS_PROJECT_REF!==REF||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||
    env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||env.STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET!==BUCKET||
    env.STUDENT_CREATORS_IDENTITY_DATA_POLICY_APPROVED!=='true'||env.STUDENT_CREATORS_PRIVATE_IDENTITY_UPLOAD_ENABLED!=='true')
    throw unavailable();
   const config=readSupabaseRuntimeConfig(env,{server:true});
   if(!config||config.url!=='https://'+REF+'.supabase.co')throw unavailable();
   const auth=createCurrentSupabaseAuth({url:config.url,publicKey:config.publishableKey,serverKey:config.serverKey,fetcher});
   const provider=createPrivateIdentityProvider({url:config.url,serverKey:config.serverKey,fetcher});
   return await createIdentityEvidenceHandler({auth,...provider})(request,context);
  }catch{return json(503,{error:'IDENTITY_STORAGE_UNAVAILABLE'});}
 };
}
