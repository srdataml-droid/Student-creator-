import {randomUUID} from 'node:crypto';
import {checkLivePaymentProvider} from './live-payment-preflight.mjs';
import {createHostedLearningRuntime} from './hosted-livekit-class.mjs';
import {buildDedicatedWorkerJobs} from './dedicated-worker.mjs';
export async function checkQuarterTwoReadiness({env=process.env,fetcher=fetch,checkPayment=checkLivePaymentProvider,createLearning=createHostedLearningRuntime,buildDedicated=buildDedicatedWorkerJobs}={}){
 const checks={};
 try{await checkPayment({env,fetcher});checks.paystack='credential_accepted_read_only';}catch{checks.paystack='configuration_or_provider_blocked';}
 try{
  const runtime=createLearning({env,fetcher});
  // Read only, unpredictable room name; never create a room or output room metadata.
  await runtime.roomService.getRoom('wk-class-'+randomUUID());
  checks.livekit='credential_accepted_read_only';
 }catch{checks.livekit='configuration_or_provider_blocked';}
 const required=env.STUDENT_CREATORS_BACKGROUND_WORKER_ENABLED==='true'&&env.STUDENT_CREATORS_PAYMENT_WORKER_ENABLED==='true'&&env.STUDENT_CREATORS_LEARNING_CLEANUP_WORKER_ENABLED==='true';
 checks.workerConfiguration='configuration_pending';
 if(required&&env.STUDENT_CREATORS_DEDICATED_WORKER_ENABLED==='true'){
  try{const jobs=buildDedicated(env,fetcher);if(!['charges','reversals','classCleanup'].every(name=>jobs.some(j=>j.name===name)))throw Error('incomplete queues');checks.workerConfiguration='configured_not_scheduled';}catch{/* configuration only, never process a job */}
 }else if(required&&typeof env.CRON_SECRET==='string'&&env.CRON_SECRET.length>=32){
  checks.workerConfiguration='configured_not_scheduled';
 }
 return {checks,providerReadiness:checks.paystack==='credential_accepted_read_only'&&checks.livekit==='credential_accepted_read_only',actualChargeVerified:false,actualStreamingVerified:false,workerScheduleVerified:false};
}
