import {reconcileMuxUpload,createMuxTestClient,createMuxVideoStore} from './mux-video-api.mjs';
import {readDedicatedSupabaseRuntimeConfig,supabaseServerHeaders} from '../../content-core/src/supabase-runtime-config.mjs';
const UUID=/^[0-9a-f-]{36}$/i, ID=/^[A-Za-z0-9_-]{6,128}$/;
const REF='jnkqmlbkkvccnxrgkpno';
const unavailable=()=>new Error('Mux worker unavailable');
const uploadKinds=new Set(['video.upload.created','video.upload.asset_created','video.upload.errored','video.upload.cancelled','video.upload.timed_out']);
const assetKinds=new Set(['video.asset.created','video.asset.ready','video.asset.errored','video.asset.updated']);
export async function processMuxEvent({queue,mux,store}){
 const event=await queue.claim();
 if(!event)return {state:'empty'};
 if(!UUID.test(event.id??'')||!UUID.test(event.leaseId??''))throw unavailable();
 let outcome='retry';
 try{
  if(!uploadKinds.has(event.kind)&&!assetKinds.has(event.kind)&&event.kind!=='video.asset.deleted')outcome='ignored';
  else if(!ID.test(event.resourceId??''))throw unavailable();
  else if(event.kind==='video.asset.deleted'){
   outcome=await queue.revoke(event.resourceId)?'processed':'retry';
  }else{
   let upload;
   if(uploadKinds.has(event.kind)){
    upload=await mux.getUpload(event.resourceId);
    if(upload.id!==event.resourceId)throw unavailable();
   }else{
    const asset=await mux.getAsset(event.resourceId);
    if(asset.id!==event.resourceId||asset.test!==true||!ID.test(asset.upload_id??'')||!UUID.test(asset.passthrough??''))throw unavailable();
    upload=await mux.getUpload(asset.upload_id);
    if(upload.id!==asset.upload_id||upload.asset_id!==asset.id||upload.new_asset_settings?.passthrough!==asset.passthrough)throw unavailable();
   }
   const reservation=upload.new_asset_settings?.passthrough;
   if(!UUID.test(reservation??'')||upload.test===false||upload.new_asset_settings?.test===false)throw unavailable();
   await reconcileMuxUpload({mux,store,row:{id:reservation},upload});
   outcome='processed';
  }
 }catch{/* Retry only bounded metadata, never raw payloads or provider errors. */}
 if(await queue.finish(event.id,event.leaseId,outcome)!==true)throw unavailable();
 return {state:outcome};
}
export function createMuxWorker({env=process.env,fetcher=fetch}={}){
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.STUDENT_CREATORS_PROJECT_REF!==REF||
 env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false'||
 env.STUDENT_CREATORS_MUX_TEST_VIDEO_ENABLED!=='true'||env.STUDENT_CREATORS_MUX_WEBHOOK_ENABLED!=='true'||
 env.STUDENT_CREATORS_MUX_WORKER_ENABLED!=='true')throw unavailable();
 const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
 if(!cfg||cfg.url!=='https://'+REF+'.supabase.co')throw unavailable();
 function alias(names){const vals=names.map(n=>env[n]).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim());if(vals.some(v=>v!==vals[0]))throw unavailable();return vals[0];}
 const mux=createMuxTestClient({tokenId:alias(['MUX_TOKEN_ID','mux_token_id']),tokenSecret:alias(['MUX_TOKEN_SECRET','mux_token_secret']),origin:env.STUDENT_CREATORS_MUX_UPLOAD_ORIGIN,fetcher});
 const store=createMuxVideoStore({url:cfg.url,serverKey:cfg.serverKey,fetcher});
 async function rpc(name,body){const r=await fetcher(new URL('/rest/v1/rpc/'+name,cfg.url),{method:'POST',headers:{...supabaseServerHeaders(cfg.serverKey),'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw unavailable();return r.json();}
 const queue={claim:()=>rpc('claim_mux_test_event',{}),finish:(id,lease,outcome)=>rpc('finish_mux_test_event',{_id:id,_lease:lease,_outcome:outcome}),revoke:asset=>rpc('revoke_deleted_mux_test_asset',{_asset:asset})};
 return ()=>processMuxEvent({queue,mux,store});
}
