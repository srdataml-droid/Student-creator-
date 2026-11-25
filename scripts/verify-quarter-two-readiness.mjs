import {checkQuarterTwoReadiness} from '../packages/hosted-core/src/quarter-two-readiness.mjs';
const result=await checkQuarterTwoReadiness();console.log(JSON.stringify(result));if(!result.providerReadiness||result.checks.workerConfiguration!=='configured_not_scheduled')process.exitCode=1;
