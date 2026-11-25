import {createHash,timingSafeEqual} from 'node:crypto';
import {createLivePaystackRuntime} from './live-paystack-runtime.mjs';
import {processHostedPaystackCharge} from './hosted-paystack-bridge.mjs';
import {processLiveReversal} from './live-reversal-worker.mjs';
import {createHostedLearningRuntime,processHostedLearningCleanup} from './hosted-livekit-class.mjs';
const digest=s=>createHash('sha256').update(s).digest();
export async function runHostedOperations({jobs,clock=()=>Date.now(),budgetMs=20000,maxRounds=4}={}){
 if(!Array.isArray(jobs)||jobs.length>8||!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>10)throw Error('INVALID_WORKER_CONFIG');
 const start=clock(),results={};
 for(let round=0;round<maxRounds;round++){
  let pending=false;
  for(const job of jobs){
   if(clock()-start>=budgetMs)break;
   const stats=results[job.name]??={processed:0,retry:0,review:0,errors:0,empty:false};
   if(stats.empty||stats.errors>0)continue;
   try{const result=await job.run();if(result.state==='empty')stats.empty=true;else if(['processed','retry','review'].includes(result.state)){stats[result.state]++;pending=true;}else stats.errors++;}
   catch{stats.errors++;}
  }
  if(!pending||clock()-start>=budgetMs)break;
 }
 return results;
}
export function buildHostedOperationsJobs(env=process.env,fetcher=fetch){
 const jobs=[];
 if(env.STUDENT_CREATORS_PAYMENT_WORKER_ENABLED==='true'){
  let runtime;const get=()=>runtime??=createLivePaystackRuntime({env,fetcher});
  jobs.push({name:'charges',run:()=>processHostedPaystackCharge(get())},{name:'reversals',run:()=>processLiveReversal(get())});
 }
 if(env.STUDENT_CREATORS_LEARNING_CLEANUP_WORKER_ENABLED==='true'){
  let runtime;const get=()=>runtime??=createHostedLearningRuntime({env,fetcher});
  jobs.push({name:'classCleanup',run:()=>processHostedLearningCleanup(get())});
 }
 return jobs;
}
export function createHostedOperationsHandler({getEnv=()=>process.env,fetcher=fetch,buildJobs=buildHostedOperationsJobs}={}){
 return async request=>{
  const respond=(status,data)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
  if(request.method!=='GET'&&request.method!=='POST')return respond(405,{error:'METHOD_NOT_ALLOWED'});
  const env=getEnv(),secret=env.CRON_SECRET,header=request.headers.get('authorization')??'';
  if(env.STUDENT_CREATORS_BACKGROUND_WORKER_ENABLED!=='true'||typeof secret!=='string'||secret.length<32||header.length>512||!timingSafeEqual(digest(header),digest('Bearer '+secret)))return respond(401,{error:'WORKER_NOT_AUTHORIZED'});
  try{const jobs=buildJobs(env,fetcher);if(!jobs.length)return respond(503,{error:'WORKERS_NOT_CONFIGURED'});const results=await runHostedOperations({jobs});return respond(Object.values(results).some(x=>x.errors||x.retry)?503:200,{results});}catch{return respond(503,{error:'WORKER_UNAVAILABLE'});}
 };
}
