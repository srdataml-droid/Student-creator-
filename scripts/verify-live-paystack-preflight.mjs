import {checkLivePaymentProvider} from '../packages/hosted-core/src/live-payment-preflight.mjs';
try{console.log(JSON.stringify(await checkLivePaymentProvider()));}catch(e){const code=/^[A-Z_]{1,80}$/.test(e?.code??'')?e.code:'LIVE_CONFIGURATION_UNAVAILABLE';console.error(JSON.stringify({status:'blocked',code}));process.exitCode=1;}
