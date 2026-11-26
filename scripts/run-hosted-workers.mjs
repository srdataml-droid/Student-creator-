import {buildDedicatedWorkerJobs,runDedicatedWorker} from '../packages/hosted-core/src/dedicated-worker.mjs';
import {writeWorkerHeartbeat,clearWorkerHeartbeat,WORKER_HEARTBEAT_PATH} from '../packages/hosted-core/src/worker-heartbeat.mjs';
const controller=new AbortController();
const stop=()=>controller.abort();
process.once('SIGTERM',stop);process.once('SIGINT',stop);
const path=process.env.STUDENT_CREATORS_WORKER_HEARTBEAT_PATH||WORKER_HEARTBEAT_PATH;
try{
 clearWorkerHeartbeat(path);
 const jobs=buildDedicatedWorkerJobs();
 writeWorkerHeartbeat(path,'starting');
 await runDedicatedWorker({jobs,signal:controller.signal,report:status=>{
  writeWorkerHeartbeat(path,status.state);
  console.log(JSON.stringify(status));
 }});
}catch{console.error('Dedicated worker unavailable');process.exitCode=1;}
finally{
 try{clearWorkerHeartbeat(path);}catch{process.exitCode=1;}
 process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
}
