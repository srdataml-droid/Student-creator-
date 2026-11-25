import {randomUUID} from 'node:crypto';
import {checkLivePaymentProvider} from './live-payment-preflight.mjs';
import {createHostedLearningRuntime} from './hosted-livekit-class.mjs';
export async function checkQuarterTwoReadiness({env=process.env,fetcher=fetch,checkPayment=checkLivePaymentProvider,createLearning=createHostedLearningRuntime}={}){
 const checks={};
 try{await checkPayment({env,fetcher});checks.paystack='credential_accepted_read_only';}catch{checks.paystack='configuration_or_provider_blocked';}
 try{
  const runtime=createLearning({env,fetcher});
  // Read only, unpredictable room name; never create a room or output room metadata.
  await runtime.roomService.getRoom('wk-class-'+randomUUID());
  checks.livekit='credential_accepted_read_only';
 }catch{checks.livekit='configuration_or_provider_blocked';}
 checks.workerConfiguration=env.STUDENT_CREATORS_BACKGROUND_WORKER_ENABLED==='true'&&env.STUDENT_CREATORS_PAYMENT_WORKER_ENABLED==='true'&&env.STUDENT_CREATORS_LEARNING_CLEANUP_WORKER_ENABLED==='true'&&typeof env.CRON_SECRET==='string'&&env.CRON_SECRET.length>=32?'configured_not_scheduled':'configuration_pending';
 return {checks,providerReadiness:checks.paystack==='credential_accepted_read_only'&&checks.livekit==='credential_accepted_read_only',actualChargeVerified:false,actualStreamingVerified:false,workerScheduleVerified:false};
}
