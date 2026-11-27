import {readWorkerHealth,WORKER_HEARTBEAT_PATH} from '../packages/hosted-core/src/worker-heartbeat.mjs';
const health=readWorkerHealth(process.env.STUDENT_CREATORS_WORKER_HEARTBEAT_PATH||WORKER_HEARTBEAT_PATH);
console.log(JSON.stringify(health));
// A degraded but advancing queue worker is alive. Alert on ready=false rather
// than restart it into an outage. A missing/stale heartbeat fails liveness.
process.exitCode=health.live?0:1;
