import {readFileSync,writeFileSync,renameSync,unlinkSync,statSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export const WORKER_HEARTBEAT_PATH='/run/student-creators/heartbeat.json';
// One admitted media job can outlast the scheduler's admission budget:
// scanner version, storage read, scan, Mux RPC/PUT, DB completion and backoff.
// Keep the stale limit above the full bounded tick, not the 45s admission budget.
export const WORKER_HEARTBEAT_MAX_AGE_MS=480000;
const states=new Set(['starting','tick_complete','degraded']);
export function clearWorkerHeartbeat(path=WORKER_HEARTBEAT_PATH){
 try{unlinkSync(path);}catch(e){if(e.code!=='ENOENT')throw e;}
}
export function writeWorkerHeartbeat(path,state,now=Date.now()){
 if(!states.has(state)||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_HEARTBEAT');
 const temp=path+'.'+randomUUID()+'.tmp';
 try{
  writeFileSync(temp,JSON.stringify({version:1,state,at:now}),{flag:'wx',mode:0o600});
  renameSync(temp,path);
 }finally{clearWorkerHeartbeat(temp);}
}
export function readWorkerHealth(path=WORKER_HEARTBEAT_PATH,{now=Date.now(),maxAgeMs=WORKER_HEARTBEAT_MAX_AGE_MS}={}){
 const unavailable={live:false,ready:false,state:'unavailable'};
 try{
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1)return unavailable;
  const stat=statSync(path);
  if(!stat.isFile()||stat.size>256)return unavailable;
  const value=JSON.parse(readFileSync(path,'utf8'));
  if(value.version!==1||!states.has(value.state)||!Number.isSafeInteger(value.at)||value.at<0||value.at>now||now-value.at>maxAgeMs)return unavailable;
  return {live:value.state!=='starting',ready:value.state==='tick_complete',state:value.state};
 }catch{return unavailable;}
}
