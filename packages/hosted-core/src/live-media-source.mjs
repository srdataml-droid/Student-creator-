import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
import {sha256} from './private-identity-api.mjs';
import {createClamdIdentityScanner} from './private-identity-scanner.mjs';
import {createMuxTestClient,createMuxVideoStore,reconcileMuxUpload,validUpload,safeUploadUrl} from './mux-video-api.mjs';
const REF='jnkqmlbkkvccnxrgkpno',BUCKET='student-creators-private-media';
export const MEDIA_MAX_BYTES=104857600;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ext={'video/mp4':'mp4','video/webm':'webm'},digest=/^[0-9a-f]{64}$/;
const unavailable=()=>new Error('MEDIA_SOURCE_UNAVAILABLE');
const respond=(status,body)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const metadata=x=>x&&Object.hasOwn(ext,x.mime)&&Number.isSafeInteger(x.bytes)&&x.bytes>=12&&x.bytes<=MEDIA_MAX_BYTES&&digest.test(x.digest??'');
function objectKey({id,creatorId,contentId,mime}){if(![id,creatorId,contentId].every(x=>UUID.test(x??''))||!Object.hasOwn(ext,mime))throw unavailable();return 'private/media/'+creatorId+'/'+contentId+'/'+id+'.'+ext[mime];}
function validMedia(bytes,mime){return bytes.length>=12&&(mime==='video/mp4'?bytes.subarray(4,8).toString('ascii')==='ftyp':mime==='video/webm'&&bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])));}
export async function readExactMediaBytes(response,expected){
 if(!response.ok||!Number.isSafeInteger(expected)||expected<12||expected>MEDIA_MAX_BYTES)throw unavailable();
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==expected))throw unavailable();
 const reader=response.body?.getReader();if(!reader)throw unavailable();
 const bytes=Buffer.alloc(expected);let offset=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.byteLength>expected)throw unavailable();bytes.set(value,offset);offset+=value.byteLength;}if(offset!==expected)throw unavailable();return bytes;}
 catch(e){void reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
}
export function createMediaSourceProvider({url,serverKey,fetcher=fetch}={}){
 if(url!=='https://'+REF+'.supabase.co'||!serverKey)throw unavailable();
 const headers=supabaseServerHeaders(serverKey);
 async function rpc(name,body){
  const r=await fetcher(new URL('/rest/v1/rpc/'+name,url),{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw unavailable();return JSON.parse(await readBoundedGatewayResponse(r,32768,unavailable));
 }
 const keyCheck=key=>{if(typeof key!=='string'||!/^private\/media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|webm)$/i.test(key))throw unavailable();return key;};
 return {
  store:{
   reserve:({creatorId,contentId,mime,bytes,digest})=>rpc('reserve_live_media_source',{_creator:creatorId,_content:contentId,_mime:mime,_bytes:bytes,_digest:digest}),
   get:({creatorId,contentId})=>rpc('get_live_media_source',{_creator:creatorId,_content:contentId}),
   restart:({creatorId,contentId,id})=>rpc('restart_live_media_source',{_creator:creatorId,_content:contentId,_id:id}),
   queue:({creatorId,contentId,id})=>rpc('queue_live_media_source',{_creator:creatorId,_content:contentId,_id:id}),
   claim:()=>rpc('claim_live_media_source',{}),
   fail:({id,leaseId,verdict})=>rpc('fail_live_media_source',{_id:id,_lease:leaseId,_verdict:verdict}),
   begin:({id,leaseId,digest,scanner})=>rpc('begin_live_media_dispatch',{_id:id,_lease:leaseId,_digest:digest,_scanner:scanner}),
   finish:({id,leaseId,uploadId})=>rpc('finish_live_media_dispatch',{_id:id,_lease:leaseId,_upload:uploadId})
  },
  storage:{
   async signedUpload(key){
    const path='/storage/v1/object/upload/sign/'+BUCKET+'/'+keyCheck(key);
    const r=await fetcher(new URL(path,url),{method:'POST',headers:{...headers,'content-type':'application/json','x-upsert':'false'},body:'{}',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw unavailable();const data=JSON.parse(await readBoundedGatewayResponse(r,8192,unavailable));
    const raw=data?.url;if(typeof raw!=='string'||raw.length>4096)throw unavailable();
    const signed=new URL(raw.startsWith('/object/')?'/storage/v1'+raw:raw,url);
    const token=signed.searchParams.get('token');
    if(signed.origin!==url||signed.pathname!==path||signed.username||signed.password||signed.hash||signed.searchParams.size!==1||typeof token!=='string'||! /^[A-Za-z0-9_.-]{16,2048}$/.test(token))throw unavailable();
    return {uploadUrl:signed.toString(),uploadToken:token};
   },
   async read(key,expected){const r=await fetcher(new URL('/storage/v1/object/authenticated/'+BUCKET+'/'+keyCheck(key),url),{method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000)});return readExactMediaBytes(r,expected);}
  }
 };
}
export function createMediaSourceHandler({auth,store,storage,origin}={}){
 return async(request,{lessonId}={})=>{
  if(!UUID.test(lessonId??''))return respond(404,{error:'LESSON_NOT_FOUND'});
  if(!['GET','POST'].includes(request.method))return respond(405,{error:'METHOD_NOT_ALLOWED'});
  const source=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if(source&&source!==origin||site&&!['same-origin','none'].includes(site))return respond(403,{error:'ORIGIN_FORBIDDEN'});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token||token.length>8192)return respond(401,{error:'AUTH_REQUIRED'});
  try{
   const user=await auth.getUser(token);if(!UUID.test(user?.id??''))return respond(401,{error:'AUTH_REQUIRED'});
   const identity={creatorId:user.id,contentId:lessonId};
   if(request.method==='GET'){const row=await store.get(identity);return row?respond(200,{id:row.id,state:row.state,videoState:row.videoState??null}):respond(404,{error:'MEDIA_SOURCE_NOT_FOUND'});}
   if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')??''))return respond(415,{error:'JSON_REQUIRED'});
   let input;try{input=JSON.parse(await readBoundedGatewayResponse(request,4096,unavailable));}catch{return respond(422,{error:'INVALID_INPUT'});}
   if(!input||typeof input!=='object'||Array.isArray(input))return respond(422,{error:'INVALID_INPUT'});
   if(input.action==='restart'&&Object.keys(input).every(k=>['action','id'].includes(k))&&UUID.test(input.id??'')){
    return await store.restart({...identity,id:input.id})===true?respond(200,{restarted:true}):respond(409,{error:'MEDIA_RESTART_NOT_AVAILABLE'});
   }
   if(input.action==='complete'&&Object.keys(input).every(k=>['action','id'].includes(k))&&UUID.test(input.id??'')){
    return await store.queue({...identity,id:input.id})===true?respond(202,{queued:true}):respond(404,{error:'MEDIA_SOURCE_NOT_FOUND'});
   }
   if(input.action!=='reserve'||Object.keys(input).some(k=>!['action','mime','bytes','digest'].includes(k))||!metadata(input))return respond(422,{error:'INVALID_INPUT'});
   const row=await store.reserve({...identity,mime:input.mime,bytes:input.bytes,digest:input.digest});
   if(!row)return respond(404,{error:'MEDIA_SOURCE_NOT_FOUND'});if(row.conflict)return respond(409,{error:'MEDIA_SOURCE_CONFLICT'});if(row.limited)return respond(429,{error:'UPLOAD_LIMIT'});
   const key=objectKey({...identity,id:row.id,mime:input.mime});if(row.objectKey!==key)throw unavailable();
   if(row.state!=='reserved')return respond(200,{id:row.id,state:row.state});
   const signed=await storage.signedUpload(key);
   if((await auth.getUser(token))?.id!==user.id)return respond(401,{error:'AUTH_REQUIRED'});
   return respond(201,{id:row.id,state:'reserved',...signed,expiresIn:7200});
  }catch{return respond(503,{error:'MEDIA_SOURCE_UNAVAILABLE'});}
 };
}
export async function processLiveMediaSource({store,storage,scanner,mux,muxStore,fetcher=fetch}={}){
 const version=await scanner.version();
 if(typeof version!=='string'||!/^ClamAV [\x20-\x7e]{1,112}$/.test(version))throw unavailable();
 const job=await store.claim();if(job===null)return {state:'empty'};
 if(!job||!metadata(job)||!UUID.test(job.leaseId??'')||objectKey(job)!==job.objectKey)throw unavailable();
 const identity={id:job.id,leaseId:job.leaseId};let dispatch=false;
 async function fail(verdict){if(await store.fail({...identity,verdict})!==true)throw unavailable();return {state:verdict==='inconclusive'?'retry':'review'};}
 try{
  const bytes=await storage.read(job.objectKey,job.bytes);
  if(!Buffer.isBuffer(bytes)||bytes.length!==job.bytes||!validMedia(bytes,job.mime)||sha256(bytes)!==job.digest)return await fail('review');
  const verdict=await scanner.scan(bytes);
  if(verdict==='malicious')return await fail('malicious');if(verdict!=='clean')return await fail('inconclusive');
  const reservation=await store.begin({...identity,digest:job.digest,scanner:version});
  if(!UUID.test(reservation?.reservationId??''))return await fail('review');
  dispatch=true;
  // Never hand the Mux provider upload URL to a browser. Only these exact bytes
  // which were hashed and scanned in this process are sent to the provider.
  const upload=await mux.create(reservation.reservationId);
  if(mux.testAsset!==false||!validUpload(upload,reservation.reservationId,null,false)||upload.status!=='waiting')throw unavailable();
  const snap=await reconcileMuxUpload({mux,store:muxStore,row:{id:reservation.reservationId},upload});
  if(snap.state!=='waiting'||!snap.uploadUrl)throw unavailable();
  const response=await fetcher(safeUploadUrl(snap.uploadUrl),{method:'PUT',headers:{'content-type':job.mime,'content-length':String(bytes.length)},body:bytes,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw unavailable();
  if(await store.finish({...identity,uploadId:upload.id})!==true)throw unavailable();
  return {state:'processed'};
 }catch{return await fail(dispatch?'review':'inconclusive');}
}
function config(env){
 if(env.STUDENT_CREATORS_ENVIRONMENT!=='production'||env.STUDENT_CREATORS_MEDIA_SOURCE_POLICY_APPROVED!=='true'||env.STUDENT_CREATORS_MUX_LIVE_VIDEO_ENABLED!=='true'||env.STUDENT_CREATORS_MUX_TEST_VIDEO_ENABLED==='true')throw unavailable();
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
 if(!cfg||cfg.url!=='https://'+REF+'.supabase.co')throw unavailable();
 return cfg;
}
export function buildMediaSourceRoute({getEnv=()=>process.env,fetcher=fetch}={}){
 return async(request,context)=>{
  try{
   const env=getEnv();if(env.STUDENT_CREATORS_MEDIA_SOURCE_UPLOAD_ENABLED!=='true')throw unavailable();
   const cfg=config(env),origin=env.STUDENT_CREATORS_MUX_UPLOAD_ORIGIN;
   if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw unavailable();
   const auth=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,requireStudent:true,fetcher});
   return createMediaSourceHandler({auth,...createMediaSourceProvider({url:cfg.url,serverKey:cfg.serverKey,fetcher}),origin})(request,context);
  }catch{return respond(503,{error:'MEDIA_SOURCE_UNAVAILABLE'});}
 };
}
export function buildMediaSourceWorker({env=process.env,fetcher=fetch}={}){
 if(env.STUDENT_CREATORS_MEDIA_SOURCE_WORKER_ENABLED!=='true')throw unavailable();
 const cfg=config(env);
 const alias=names=>{const v=names.map(n=>env[n]).filter(s=>typeof s==='string'&&s.trim()).map(s=>s.trim());if(v.some(s=>s!==v[0]))throw unavailable();return v[0];};
 const mux=createMuxTestClient({tokenId:alias(['MUX_TOKEN_ID','mux_token_id']),tokenSecret:alias(['MUX_TOKEN_SECRET','mux_token_secret']),origin:env.STUDENT_CREATORS_MUX_UPLOAD_ORIGIN,testAsset:false,fetcher});
 const muxStore=createMuxVideoStore({url:cfg.url,serverKey:cfg.serverKey,testAsset:false,fetcher});
 const scanner=createClamdIdentityScanner({socketPath:env.CLAMD_SOCKET,maxBytes:MEDIA_MAX_BYTES,timeoutMs:90000});
 const provider=createMediaSourceProvider({url:cfg.url,serverKey:cfg.serverKey,fetcher});
 return ()=>processLiveMediaSource({...provider,mux,muxStore,scanner,fetcher});
}
