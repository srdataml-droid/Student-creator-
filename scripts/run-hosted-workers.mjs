import {buildDedicatedWorkerJobs,runDedicatedWorker} from '../packages/hosted-core/src/dedicated-worker.mjs';
const controller=new AbortController();
const stop=()=>controller.abort();
process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 const jobs=buildDedicatedWorkerJobs();
 await runDedicatedWorker({jobs,signal:controller.signal,report:status=>console.log(JSON.stringify(status))});
}catch{console.error('Dedicated worker unavailable');process.exitCode=1;}
finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
