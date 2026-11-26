import {createLivePaystackRuntime} from '../packages/hosted-core/src/live-paystack-runtime.mjs';
import {processHostedPaystackCharge} from '../packages/hosted-core/src/hosted-paystack-bridge.mjs';
import {processLiveReversal} from '../packages/hosted-core/src/live-reversal-worker.mjs';
try{
 const runtime=createLivePaystackRuntime(), results=[];
 for(let i=0;i<25;i++){const charge=await processHostedPaystackCharge(runtime),reversal=await processLiveReversal(runtime);results.push({charge,reversal});if(charge.state==='empty'&&reversal.state==='empty')break;}
 console.log(JSON.stringify(results));if(results.some(r=>r.charge.state==='retry'||['retry','review'].includes(r.reversal.state)))process.exitCode=2;
}catch{console.error('Live payment reconciliation unavailable');process.exitCode=1;}
