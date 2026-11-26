import {createHostedPaystackRuntime,processHostedPaystackCharge} from '../packages/hosted-core/src/hosted-paystack-bridge.mjs';
try{console.log(JSON.stringify(await processHostedPaystackCharge(createHostedPaystackRuntime())));}catch{console.error('Hosted payment worker unavailable');process.exitCode=1;}
