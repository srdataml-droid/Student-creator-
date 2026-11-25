import {createMuxWorker} from '../packages/hosted-core/src/mux-event-worker.mjs';
try{console.log(JSON.stringify(await createMuxWorker()()));}catch{console.error('Mux worker unavailable');process.exitCode=1;}
