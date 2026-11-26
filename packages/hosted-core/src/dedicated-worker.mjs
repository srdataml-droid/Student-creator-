import {setTimeout as wait} from 'node:timers/promises';
import {buildHostedOperationsJobs,runHostedOperations} from './hosted-operations.mjs';
import {readDedicatedSupabaseRuntimeConfig} from '../../content-core/src/supabase-runtime-config.mjs';
import {createPrivateIdentityProvider} from './private-identity-api.mjs';
import {createClamdIdentityScanner,processNextIdentityScan} from './private-identity-scanner.mjs';
import {buildMediaSourceWorker} from './live-media-source.mjs';
import {buildPayoutTransferWorker} from './payout-transfer-worker.mjs';
const unavailable=()=>new Error('DEDICATED_WORKER_CONFIGURATION_UNAVAILABLE');
export function buildDedicatedWorkerJobs(env=process.env,fetcher=fetch,{operationsFactory=buildHostedOperationsJobs,providerFactory=createPrivateIdentityProvider,scannerFactory=createClamdIdentityScanner,scan=processNextIdentityScan}={}){
 if(env.STUDENT_CREATORS_BACKGROUND_WORKER_ENABLED!=='true'||env.STUDENT_CREATORS_DEDICATED_WORKER_ENABLED!=='true')throw unavailable();
 const jobs=operationsFactory(env,fetcher);
 if(env.STUDENT_CREATORS_IDENTITY_SCANNER_ENABLED==='true'){
  if(env.STUDENT_CREATORS_IDENTITY_DATA_POLICY_APPROVED!=='true'||env.STUDENT_CREATORS_PRIVATE_IDENTITY_BUCKET!=='student-creators-private-identity')throw unavailable();
  const cfg=readDedicatedSupabaseRuntimeConfig(env,{server:true});
  if(!cfg)throw unavailable();
  const provider=providerFactory({url:cfg.url,serverKey:cfg.serverKey,fetcher});
  const scanner=scannerFactory({socketPath:env.CLAMD_SOCKET});
  jobs.push({name:'identityScan',run:async()=>{
   const r=await scan({...provider,scanner});
   if(r.status==='idle')return {state:'empty'};
   if(r.status==='clean')return {state:'processed'};
   if(r.status==='malicious')return {state:'review'};
   if(r.status==='inconclusive')return {state:'retry'};
   throw unavailable();
  }});
 }
 if(env.STUDENT_CREATORS_MEDIA_SOURCE_WORKER_ENABLED==='true'){const run=buildMediaSourceWorker({env,fetcher});jobs.push({name:'mediaSource',run});}
 if(env.STUDENT_CREATORS_PAYOUT_TRANSFER_WORKER_ENABLED==='true'){const run=buildPayoutTransferWorker({env,fetcher});jobs.push({name:'payoutTransfers',run});}
 if(!jobs.length)throw unavailable();
 return jobs;
}
export async function runDedicatedWorker({jobs,signal,intervalMs=15000,maxDelayMs=60000,sleep=wait,run=runHostedOperations,report=()=>{}}={}){
 if(!Array.isArray(jobs)||jobs.length===0||jobs.length>8||!signal||!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>60000||!Number.isInteger(maxDelayMs)||maxDelayMs<intervalMs||maxDelayMs>300000)throw unavailable();
 let cursor=0,failures=0;
 // Exactly one tick per process at a time. DB leases remain authoritative
 // across replicas; no in-memory lock is mistaken for a distributed lease.
 while(!signal.aborted){
  const ordered=[...jobs.slice(cursor),...jobs.slice(0,cursor)];
  cursor=(cursor+1)%jobs.length;
  let result,failed;
  try{
   result=await run({jobs:ordered,budgetMs:45000,maxRounds:2});
   failed=Object.values(result).some(x=>!x.attempted||x.errors||x.retry);
  }catch{result={};failed=true;}
  failures=failed?Math.min(failures+1,8):0;
  report({state:failed?'degraded':'tick_complete',queues:result});
  if(signal.aborted)break;
  try{await sleep(Math.min(maxDelayMs,intervalMs*2**failures),undefined,{signal});}
  catch{if(!signal.aborted)throw unavailable();}
 }
 return {state:'stopped'};
}
