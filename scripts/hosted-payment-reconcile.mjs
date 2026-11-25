/** Explicit, one-shot hosted sandbox inbox drain. Never enables checkout or charges. */
import {createConfiguredHostedRecovery} from '../packages/hosted-core/src/hosted-test-commerce.mjs';
try{
 const worker=createConfiguredHostedRecovery(process.env);
 const counts={processed:0,failed:0,dead_letter:0,superseded:0,idle:0};
 for(let i=0;i<25;i++){
  const result=await worker.drainOne();
  counts[result.state]++;
  if(result.state==='idle')break;
 }
 console.log(JSON.stringify(counts));
 if(counts.failed||counts.dead_letter||counts.superseded)process.exitCode=2;
}catch(e){console.error(typeof e?.code==='string'&&/^[A-Z_]{1,60}$/.test(e.code)?e.code:'HOSTED_PAYMENT_RECOVERY_FAILED');process.exitCode=1;}
