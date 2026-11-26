import {auditPaystackSettlement} from '../packages/hosted-core/src/live-settlement-audit.mjs';
try{const [settlementId,from,to]=process.argv.slice(2);console.log(JSON.stringify(await auditPaystackSettlement({settlementId,from,to})));}catch{console.error('Settlement audit unavailable; no money movement attempted.');process.exitCode=1;}
