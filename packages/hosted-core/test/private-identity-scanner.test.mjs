import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClamdIdentityScanner,processNextIdentityScan} from '../src/private-identity-scanner.mjs';
import {sha256} from '../src/private-identity-api.mjs';
const file=Buffer.from('%PDF-synthetic-data');
test('real Unix socket transport sends bounded clamd INSTREAM framing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'identity-scan-'));const path=join(dir,'clamd.sock');let seen;
 const server=createServer(socket=>{
  let input=Buffer.alloc(0);
  socket.on('data',chunk=>{
   input=Buffer.concat([input,chunk]);
   if(input.equals(Buffer.from('zVERSION\0')))return socket.end('ClamAV 1.4.3/synthetic\0');
   if(input.length>=10+4+file.length+4&&input.subarray(0,10).equals(Buffer.from('zINSTREAM\0'))){
    seen=input;socket.end('stream: OK\0');
   }
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
 try{
  const scanner=createClamdIdentityScanner({socketPath:path,timeoutMs:1000});
  assert.equal(await scanner.version(),'ClamAV 1.4.3/synthetic');assert.equal(await scanner.scan(file),'clean');
  assert.equal(seen.readUInt32BE(10),file.length);assert.deepEqual(seen.subarray(14,-4),file);assert.equal(seen.readUInt32BE(seen.length-4),0);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('worker checks exact bytes before scanner, records only lease-bound result',async()=>{
 const ownerId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',leaseId='44444444-4444-4444-8444-444444444444';
 const job={id,ownerId,requestId,leaseId,mime:'application/pdf',bytes:file.length,digest:sha256(file),objectKey:'private/'+ownerId+'/'+requestId+'/'+id+'.pdf'};
 for(const [data,scanResult,expected] of [[file,'clean','clean'],[file,'malicious','malicious'],[Buffer.from('tampered'),'clean','inconclusive'],[file,'unknown','inconclusive']]){
  let captured,scans=0;
  const r=await processNextIdentityScan({store:{claimScan:async()=>job,recordScan:async x=>{captured=x;return true;}},storage:{read:async()=>data},scanner:{version:async()=> 'ClamAV 1.4.3/synthetic',scan:async()=>{scans++;return scanResult;}}});
  assert.deepEqual(r,{status:expected});assert.equal(captured.leaseId,leaseId);assert.equal(captured.verdict,expected);
  assert.equal(scans,data===file?1:0);
 }
});
test('scanner unavailable never claims a retry; missing job is idle',async()=>{
 let calls=0;const store={claimScan:async()=>{calls++;return null;}};
 await assert.rejects(processNextIdentityScan({store,scanner:{version:async()=>{throw Error('offline');}}}));
 assert.equal(calls,0);
 assert.deepEqual(await processNextIdentityScan({store,scanner:{version:async()=> 'ClamAV 1.4.3/synthetic'}}),{status:'idle'});
 assert.throws(()=>createClamdIdentityScanner({socketPath:'tcp://untrusted.example:3310'}));
});
