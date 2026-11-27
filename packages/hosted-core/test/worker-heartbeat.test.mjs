import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,statSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {clearWorkerHeartbeat,writeWorkerHeartbeat,readWorkerHealth,WORKER_HEARTBEAT_MAX_AGE_MS} from '../src/worker-heartbeat.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'worker-health-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'heartbeat.json')};}
test('heartbeat atomically records only redacted state with private permissions',t=>{const {dir,path}=fixture(t);writeWorkerHeartbeat(path,'starting',100);assert.deepEqual(readWorkerHealth(path,{now:100}),{live:false,ready:false,state:'starting'});writeWorkerHeartbeat(path,'tick_complete',200);assert.deepEqual(readWorkerHealth(path,{now:201}),{live:true,ready:true,state:'tick_complete'});assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{version:1,state:'tick_complete',at:200});assert.equal(statSync(path).mode&0o777,0o600);assert.deepEqual(readdirSync(dir),['heartbeat.json']);});
test('health denies absent, stale, future, oversized and malformed state',t=>{const {path}=fixture(t);assert.equal(readWorkerHealth(path,{now:100}).live,false);writeWorkerHeartbeat(path,'tick_complete',100);assert.equal(readWorkerHealth(path,{now:101,maxAgeMs:1}).live,true);assert.equal(readWorkerHealth(path,{now:102,maxAgeMs:1}).live,false);assert.equal(readWorkerHealth(path,{now:99}).live,false);writeFileSync(path,'x'.repeat(257));assert.equal(readWorkerHealth(path,{now:100}).live,false);writeFileSync(path,'{}');assert.equal(readWorkerHealth(path,{now:100}).live,false);assert.throws(()=>writeWorkerHeartbeat(path,'secret'));clearWorkerHeartbeat(path);clearWorkerHeartbeat(path);assert.equal(readWorkerHealth(path,{now:100}).live,false);});
test('health command distinguishes degraded live worker from unavailable process',t=>{const {path}=fixture(t);const run=()=>spawnSync(process.execPath,['scripts/check-worker-health.mjs'],{env:{...process.env,STUDENT_CREATORS_WORKER_HEARTBEAT_PATH:path},encoding:'utf8'});assert.equal(run().status,1);writeWorkerHeartbeat(path,'degraded');let r=run();assert.equal(r.status,0);assert.deepEqual(JSON.parse(r.stdout),{live:true,ready:false,state:'degraded'});writeWorkerHeartbeat(path,'tick_complete');r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).ready,true);clearWorkerHeartbeat(path);assert.equal(run().status,1);});

test('a long bounded media dispatch and backoff is not mistaken for a crashed worker',t=>{const {path}=fixture(t);writeWorkerHeartbeat(path,'tick_complete',1000);assert.equal(readWorkerHealth(path,{now:1000+420000}).live,true);assert.equal(readWorkerHealth(path,{now:1000+WORKER_HEARTBEAT_MAX_AGE_MS}).live,true);assert.equal(readWorkerHealth(path,{now:1001+WORKER_HEARTBEAT_MAX_AGE_MS}).live,false);});

test('explicit readiness command fails closed without changing Docker liveness',t=>{
 const {path}=fixture(t);
 const run=(...args)=>spawnSync(process.execPath,['scripts/check-worker-health.mjs',...args],{env:{...process.env,STUDENT_CREATORS_WORKER_HEARTBEAT_PATH:path},encoding:'utf8'});
 assert.equal(run('--require-ready').status,1);
 writeWorkerHeartbeat(path,'starting');
 assert.equal(run('--require-ready').status,1);
 writeWorkerHeartbeat(path,'degraded');
 assert.equal(run().status,0);
 const degraded=run('--require-ready');
 assert.equal(degraded.status,1);
 assert.deepEqual(JSON.parse(degraded.stdout),{live:true,ready:false,state:'degraded'});
 writeWorkerHeartbeat(path,'tick_complete');
 assert.equal(run('--require-ready').status,0);
 assert.equal(run('--unknown').status,2);
 assert.equal(run('--require-ready','--require-ready').status,2);
 writeWorkerHeartbeat(path,'tick_complete',Date.now()-WORKER_HEARTBEAT_MAX_AGE_MS-1000);
 assert.equal(run('--require-ready').status,1);
 writeFileSync(path,'{}');
 assert.equal(run('--require-ready').status,1);
});
