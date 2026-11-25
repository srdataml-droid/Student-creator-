import {createCurrentSupabaseAuth} from './supabase-current-auth.mjs';
import {issueAuthorizedMuxPlayback} from './mux-playback.mjs';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../../payment-core/src/bounded-response.mjs';
const REF='jnkqmlbkkvccnxrgkpno';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const unavailable=()=>new Error('Mux video unavailable');
const json=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer'}});
const states=['initializing','waiting','processing','ready','errored','cancelled','timed_out','deleted','unsafe'];
function validOrigin(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password&&!!u.hostname;}catch{return false;}
}
export function safeUploadUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!u.search||
 !(u.hostname==='storage.googleapis.com'||u.hostname.endsWith('.storage.googleapis.com')||u.hostname.endsWith('.mux.com')||u.hostname.endsWith('.amazonaws.com')))
 throw unavailable();return u.toString();}catch{throw unavailable();}
}
function alias(env,names){
 const vals=names.map(n=>env[n]).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim());
 if(vals.some(v=>v!==vals[0]))throw unavailable();return vals[0];
}
export function createMuxTestClient({tokenId,tokenSecret,origin,fetcher=fetch,testAsset=true}={}){
 if(!ID.test(tokenId??'')||typeof tokenSecret!=='string'||tokenSecret.length<8||tokenSecret.length>512||
 tokenSecret.includes('\n')||!validOrigin(origin))throw unavailable();
 const headers={authorization:'Basic '+Buffer.from(tokenId+':'+tokenSecret).toString('base64'),'content-type':'application/json'};
 async function call(path,body){
  const r=await fetcher(new URL('/video/v1/'+path,'https://api.mux.com'),{method:body?'POST':'GET',headers,
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw unavailable();
  const data=JSON.parse(await readBoundedGatewayResponse(r,262144,unavailable))?.data;
  if(!data||typeof data!=='object'||Array.isArray(data))throw unavailable();return data;
 }
 return {
  testAsset,
  create:reservation=>{if(!UUID.test(reservation))throw unavailable();return call('uploads',{cors_origin:origin,timeout:900,test:testAsset,
   new_asset_settings:{test:testAsset,playback_policies:['signed'],video_quality:'basic',passthrough:reservation,master_access:'none'}});},
  getUpload:id=>{if(!ID.test(id))throw unavailable();return call('uploads/'+id);},
  getAsset:id=>{if(!ID.test(id))throw unavailable();return call('assets/'+id);}
 };
}
const modeMatches=(value,testAsset)=>testAsset?value===true:value===false||value===undefined;
export function validUpload(data,reservation,uploadId,testAsset=true){
 const settings=data?.new_asset_settings;
 return ID.test(data?.id??'')&&(!uploadId||data.id===uploadId)&&settings?.passthrough===reservation&&
 Array.isArray(settings.playback_policies)&&settings.playback_policies.length===1&&settings.playback_policies[0]==='signed'&&
 modeMatches(data.test,testAsset)&&(testAsset?settings.test!==false:modeMatches(settings.test,false));
}
export function assetSnapshot(asset,reservation,uploadId,assetId,testAsset=true){
 if(asset?.id!==assetId||asset.passthrough!==reservation||asset.upload_id!==uploadId||!modeMatches(asset.test,testAsset)||
 (Array.isArray(asset.playback_ids)&&asset.playback_ids.some(p=>p?.policy!=='signed')))
 return {state:'unsafe',assetId,playbackId:null};
 if(asset.status==='errored')return {state:'errored',assetId,playbackId:null};
 if(asset.status==='preparing')return {state:'processing',assetId,playbackId:null};
 if(asset.status==='ready'&&asset.playback_ids?.length===1&&ID.test(asset.playback_ids[0]?.id??''))
  return {state:'ready',assetId,playbackId:asset.playback_ids[0].id};
 return {state:'unsafe',assetId,playbackId:null};
}
export async function reconcileMuxUpload({mux,store,row,upload}){
 if(!UUID.test(row?.id??'')||!validUpload(upload,row.id,row.uploadId,mux.testAsset!==false))throw unavailable();
 let snap={state:upload.status,assetId:null,playbackId:null};
 let uploadUrl;
 if(upload.status==='waiting')uploadUrl=safeUploadUrl(upload.url);
 else if(upload.status==='asset_created'&&ID.test(upload.asset_id??'')){
  snap=assetSnapshot(await mux.getAsset(upload.asset_id),row.id,upload.id,upload.asset_id,mux.testAsset!==false);
 }else if(!['errored','cancelled','timed_out'].includes(upload.status))throw unavailable();
 const updated=await store.apply({reservation:row.id,uploadId:upload.id,...snap});
 if(!updated||updated.id!==row.id||!states.includes(updated.state))throw unavailable();
 return {id:row.id,state:updated.state,...(updated.state==='waiting'&&uploadUrl?{uploadUrl}:{})};
}

export function createMuxUploadHandler({auth,store,mux,origin}={}){
 return async (request,{lessonId}={})=>{
  if(!UUID.test(lessonId??''))return json(404,{error:'LESSON_NOT_FOUND'});
  if(!['GET','POST'].includes(request.method))return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(request.method==='POST'&&request.headers.get('origin')!==origin)return json(403,{error:'ORIGIN_FORBIDDEN'});
  if(request.body)return json(400,{error:'UNEXPECTED_BODY'});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return json(401,{error:'AUTH_REQUIRED'});
  try{
   const user=await auth.getUser(token);if(!user)return json(401,{error:'AUTH_REQUIRED'});
   const row=await (request.method==='POST'?store.reserve({creator:user.id,lessonId}):store.get({creator:user.id,lessonId}));
   if(!row)return json(404,{error:'UPLOAD_NOT_FOUND'});
   if(row.limited===true)return json(429,{error:'UPLOAD_LIMIT'});
   if(!UUID.test(row.id??'')||!states.includes(row.state))throw unavailable();
   if(row.create===true){
    // A durable reservation is committed before POST. Never auto-repeat a
    // possibly successful provider creation when association is uncertain.
    const result=await reconcileMuxUpload({mux,store,row,upload:await mux.create(row.id)});
    return json(201,{upload:result});
   }
   if(!row.uploadId||['errored','cancelled','timed_out','deleted','unsafe'].includes(row.state))
    return json(row.state==='initializing'?202:200,{upload:{id:row.id,state:row.state}});
   const result=await reconcileMuxUpload({mux,store,row,upload:await mux.getUpload(row.uploadId)});
   return json(200,{upload:result});
  }catch{return json(503,{error:'MUX_UPLOAD_UNAVAILABLE'});}
 };
}

export function createMuxPlaybackHandler({auth,store,mux,signingKeyId,privateKeyBase64}={}){
 return async(request,{lessonId}={})=>{
  if(!UUID.test(lessonId??''))return json(404,{error:'LESSON_NOT_FOUND'});
  if(request.method!=='GET')return json(405,{error:'METHOD_NOT_ALLOWED'});
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)return json(401,{error:'AUTH_REQUIRED'});
  try{
   const user=await auth.getUser(token);if(!user)return json(401,{error:'AUTH_REQUIRED'});
   const lesson=await store.authorizedPlayback({viewer:user.id,lessonId});
   if(!lesson||lesson.viewerId!==user.id||lesson.id!==lessonId)return json(403,{error:'PLAYBACK_FORBIDDEN'});
   // Recheck the provider before every staging grant; a deleted, public or
   // differently associated asset must never get a fresh signed token.
   const current=assetSnapshot(await mux.getAsset(lesson.assetId),lesson.reservationId,lesson.uploadId,lesson.assetId,mux.testAsset!==false);
   if(current.state!=='ready'||current.playbackId!==lesson.playbackId)return json(403,{error:'PLAYBACK_UNAVAILABLE'});
   const grant=await issueAuthorizedMuxPlayback({viewer:user,lessonId,loadLesson:async()=>lesson,
    authorizeViewer:async({viewer})=>viewer.id===lesson.viewerId,signingKeyId,privateKeyBase64,ttlSeconds:120});
   return json(200,grant);
  }catch{return json(503,{error:'MUX_PLAYBACK_UNAVAILABLE'});}
 };
}
export function createMuxVideoStore({url,serverKey,fetcher=fetch,testAsset=true}){
 if(url!=='https://'+REF+'.supabase.co'||!serverKey)throw unavailable();
 async function rpc(name,body){
  const r=await fetcher(new URL('/rest/v1/rpc/'+name,url),{method:'POST',
   headers:{...supabaseServerHeaders(serverKey),'content-type':'application/json'},body:JSON.stringify(body),
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw unavailable();return r.json();
 }
 const mode=testAsset?'test':'live';
 return {reserve:({creator,lessonId})=>rpc('reserve_mux_'+mode+'_upload',{_creator:creator,_content:lessonId}),
  get:({creator,lessonId})=>rpc('get_mux_'+mode+'_upload',{_creator:creator,_content:lessonId}),
  apply:({reservation,uploadId,assetId,playbackId,state})=>rpc('apply_mux_'+mode+'_snapshot',{_reservation:reservation,_upload:uploadId,_asset:assetId,_playback:playbackId,_state:state}),
  authorizedPlayback:({viewer,lessonId})=>rpc('authorized_mux_'+mode+'_playback',{_viewer:viewer,_content:lessonId})};
}
export function buildMuxVideoRoute({getEnv=()=>process.env,fetcher=fetch,playback=false}={}){
 return async(request,context)=>{
  try{
   const env=getEnv();
   const testAsset=env.STUDENT_CREATORS_ENVIRONMENT!=='production';
   if((testAsset&&env.STUDENT_CREATORS_MUX_TEST_VIDEO_ENABLED!=='true')||(!testAsset&&(env.STUDENT_CREATORS_MUX_LIVE_VIDEO_ENABLED!=='true'||env.STUDENT_CREATORS_MUX_TEST_VIDEO_ENABLED==='true')))throw unavailable();
   const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
   if(!cfg||cfg.url!=='https://'+REF+'.supabase.co')throw unavailable();
   const origin=env.STUDENT_CREATORS_MUX_UPLOAD_ORIGIN;
   const mux=createMuxTestClient({tokenId:alias(env,['MUX_TOKEN_ID','mux_token_id']),
    tokenSecret:alias(env,['MUX_TOKEN_SECRET','mux_token_secret']),origin,fetcher,testAsset});
   const auth=createCurrentSupabaseAuth({url:cfg.url,publicKey:cfg.publishableKey,serverKey:cfg.serverKey,requireStudent:true,fetcher});
   const store=createMuxVideoStore({url:cfg.url,serverKey:cfg.serverKey,fetcher,testAsset});
   const handler=playback?createMuxPlaybackHandler({auth,store,mux,
    signingKeyId:alias(env,['MUX_PLAYBACK_SIGNING_KEY_ID','mux_playback_signing_key_id']),
    privateKeyBase64:alias(env,['MUX_PLAYBACK_PRIVATE_KEY_BASE64','mux_playback_private_key_base64'])})
    :createMuxUploadHandler({auth,store,mux,origin});
   return await handler(request,context);
  }catch{return json(503,{error:'MUX_VIDEO_UNAVAILABLE'});}
 };
}
