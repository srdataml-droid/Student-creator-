import {createLivePaystackRuntime} from '../packages/hosted-core/src/live-paystack-runtime.mjs';
import {processHostedPaystackCharge} from '../packages/hosted-core/src/hosted-paystack-bridge.mjs';
try{console.log(JSON.stringify(await processHostedPaystackCharge(createLivePaystackRuntime())));}catch{console.error('Live payment reconciliation unavailable');process.exitCode=1;}
