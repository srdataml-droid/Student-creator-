import {readWorkerHealth,WORKER_HEARTBEAT_PATH} from '../packages/hosted-core/src/worker-heartbeat.mjs';
const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&args[0]!=='--require-ready')){
 console.error('Usage: node scripts/check-worker-health.mjs [--require-ready]');
 process.exitCode=2;
}else{
 const health=readWorkerHealth(process.env.STUDENT_CREATORS_WORKER_HEARTBEAT_PATH||WORKER_HEARTBEAT_PATH);
 console.log(JSON.stringify(health));
 // Docker liveness must tolerate degradation to avoid restart loops.
 // Explicit operator acceptance requires a successful recent tick.
 process.exitCode=(args.length===1?health.ready:health.live)?0:1;
}
