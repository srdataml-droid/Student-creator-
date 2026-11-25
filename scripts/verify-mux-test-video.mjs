import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readDedicatedSupabaseRuntimeConfig} from '../packages/content-core/src/supabase-runtime-config.mjs';
import {readBoundedGatewayResponse} from '../packages/payment-core/src/bounded-response.mjs';
import {createMuxTestClient,safeUploadUrl,validUpload,assetSnapshot} from '../packages/hosted-core/src/mux-video-api.mjs';
import {issueAuthorizedMuxPlayback} from '../packages/hosted-core/src/mux-playback.mjs';
const ID=/^[A-Za-z0-9_-]{6,128}$/;
const fail=code=>Object.assign(new Error(code),{code});
const assert=(ok,code)=>{if(!ok)throw fail(code);};
const safe=e=>typeof e?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(e.code)?e.code:'MUX_PROVIDER_UNAVAILABLE';
function alias(env,names){const v=names.map(n=>env[n]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim());assert(!v.some(x=>x!==v[0]),'CONFLICTING_MUX_KEYS');return v[0];}
function syntheticClip(){
 // No input path, URL, or user-provided video can reach the provider.
 return execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=320x240:r=24',
 '-t','2','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],
 {timeout:15000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});
}
async function manifest(fetcher,url){
 let u=new URL(url);
 for(let i=0;i<4;i++){
  assert(u.protocol==='https:'&&u.hostname.endsWith('.mux.com')&&!u.port&&!u.username&&!u.password,'UNSAFE_MANIFEST_HOST');
  const r=await fetcher(u,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if([301,302,303,307,308].includes(r.status)){
   const location=r.headers.get('location');assert(location,'MANIFEST_REDIRECT_INVALID');u=new URL(location,u);continue;
  }
  return r;
 }
 throw fail('MANIFEST_REDIRECT_LIMIT');
}
export async function verifyMuxTestVideo({env=process.env,fetcher=fetch,makeClip=syntheticClip,pause=sleep,maxPolls=40}={}){
 assert(env.STUDENT_CREATORS_MUX_ACCEPTANCE_ENABLED==='true'&&env.STUDENT_CREATORS_MUX_TEST_VIDEO_ENABLED==='true','ACCEPTANCE_DISABLED');
 assert(readDedicatedSupabaseRuntimeConfig(env,{server:true}),'STAGING_NOT_APPROVED');
 const tokenId=alias(env,['MUX_TOKEN_ID','mux_token_id']),tokenSecret=alias(env,['MUX_TOKEN_SECRET','mux_token_secret']);
 const origin=env.STUDENT_CREATORS_MUX_UPLOAD_ORIGIN;
 const signingKeyId=alias(env,['MUX_PLAYBACK_SIGNING_KEY_ID','mux_playback_signing_key_id']);
 const privateKeyBase64=alias(env,['MUX_PLAYBACK_PRIVATE_KEY_BASE64','mux_playback_private_key_base64']);
 const mux=createMuxTestClient({tokenId,tokenSecret,origin,fetcher});
 const reservation=randomUUID(),viewer={id:randomUUID()},lessonId=randomUUID();
 // Validate RSA signing configuration locally before provisioning anything.
 const signGrant=async playbackId=>issueAuthorizedMuxPlayback({viewer,lessonId,loadLesson:async()=>({id:lessonId,status:'published',videoStatus:'ready',playbackPolicy:'signed',playbackId}),
 authorizeViewer:async()=>true,signingKeyId,privateKeyBase64,ttlSeconds:120});
 await signGrant('synthetic_playback_validation');
 const clip=makeClip();assert(Buffer.isBuffer(clip)&&clip.length>=16&&clip.length<=1048576&&clip.subarray(4,8).toString()==='ftyp','SYNTHETIC_VIDEO_INVALID');
 const headers={authorization:'Basic '+Buffer.from(tokenId+':'+tokenSecret).toString('base64')};
 let uploadId,assetId,cleanupVerified=false,attempted=false,failure=null,providerAsset;
 try{
  attempted=true;
  const upload=await mux.create(reservation);
  assert(validUpload(upload,reservation)&&upload.status==='waiting','TEST_UPLOAD_NOT_PROVEN');
  uploadId=upload.id;
  const sent=await fetcher(safeUploadUrl(upload.url),{method:'PUT',headers:{'content-type':'video/mp4'},body:clip,redirect:'error',signal:AbortSignal.timeout(30000)});
  assert(sent.ok,'TEST_UPLOAD_FAILED');
  for(let i=0;i<maxPolls;i++){
   const current=await mux.getUpload(uploadId);
   assert(validUpload(current,reservation,uploadId),'TEST_UPLOAD_BINDING_MISMATCH');
   if(current.status==='asset_created'&&ID.test(current.asset_id??'')){
    const asset=await mux.getAsset(current.asset_id);
    assert(asset.id===current.asset_id&&asset.upload_id===uploadId&&asset.passthrough===reservation&&asset.test===true,'TEST_ASSET_BINDING_MISMATCH');
    assetId=asset.id;providerAsset=asset;
    const snap=assetSnapshot(asset,reservation,uploadId,assetId);
    if(snap.state==='ready')break;
    assert(snap.state==='processing','TEST_ASSET_FAILED');
   }else assert(current.status==='waiting','TEST_UPLOAD_FAILED');
   await pause(2500);
  }
  assert(providerAsset?.status==='ready','TEST_ASSET_TIMEOUT');
  const snap=assetSnapshot(providerAsset,reservation,uploadId,assetId);
  assert(snap.state==='ready','SIGNED_TEST_ASSET_REQUIRED');
  const signed=await signGrant(snap.playbackId);
  const unsigned=new URL(signed.url);unsigned.search='';
  const denied=await manifest(fetcher,unsigned);
  assert([400,401,403,404].includes(denied.status),'UNSIGNED_MANIFEST_NOT_DENIED');
  const allowed=await manifest(fetcher,signed.url);
  assert(allowed.ok,'SIGNED_MANIFEST_UNAVAILABLE');
  const playlist=await readBoundedGatewayResponse(allowed,262144,()=>fail('MANIFEST_INVALID'));
  assert(playlist.startsWith('#EXTM3U')&&/#EXT-X-(STREAM-INF|TARGETDURATION)/.test(playlist),'MANIFEST_INVALID');
 }catch(e){failure=safe(e);}
 // Delete/cancel only resources with a freshly verified test flag and exact
 // random reservation association. Never delete a foreign or live asset.
 if(uploadId){
  try{
   const current=await mux.getUpload(uploadId);
   assert(validUpload(current,reservation,uploadId),'TEST_UPLOAD_BINDING_MISMATCH');
   if(current.status==='asset_created'&&ID.test(current.asset_id??'')){
    const asset=await mux.getAsset(current.asset_id);
    assert(asset.id===current.asset_id&&asset.upload_id===uploadId&&asset.passthrough===reservation&&asset.test===true,'TEST_ASSET_BINDING_MISMATCH');
    const path='https://api.mux.com/video/v1/assets/'+asset.id;
    const removed=await fetcher(path,{method:'DELETE',headers,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(removed.ok||removed.status===404){
     const check=await fetcher(path,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)});
     cleanupVerified=check.status===404;
    }
   }else if(current.status==='waiting'){
    const cancelled=await fetcher('https://api.mux.com/video/v1/uploads/'+uploadId+'/cancel',{method:'PUT',headers,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(cancelled.ok){const check=await mux.getUpload(uploadId);cleanupVerified=validUpload(check,reservation,uploadId)&&check.status==='cancelled';}
   }else cleanupVerified=['errored','cancelled','timed_out'].includes(current.status)&&!current.asset_id;
  }catch{cleanupVerified=false;}
 }
 if(attempted&&!cleanupVerified)throw fail('TEST_RESOURCE_CLEANUP_UNVERIFIED');
 if(failure)throw fail(failure);
 return {status:'passed',testUpload:true,signedManifest:true,unsignedDenied:true,cleanupVerified:true,applicationEntitlementVerified:false,browserPlaybackVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await verifyMuxTestVideo()));}
 catch(e){console.error(JSON.stringify({status:'failed',code:safe(e)}));process.exitCode=1;}
}
