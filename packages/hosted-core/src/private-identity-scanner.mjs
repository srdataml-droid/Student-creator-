import {createConnection} from 'node:net';
import {isAbsolute} from 'node:path';
import {IDENTITY_MAX_BYTES,sha256} from './private-identity-api.mjs';

const invalid=()=>new Error('Identity scanner unavailable');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ext={'image/jpeg':'jpg','image/png':'png','application/pdf':'pdf'};

// Original implementation of the documented clamd Unix socket protocol.
// No remote unencrypted scanner endpoint; no provider commands from users.
function clamdExchange(socketPath,payload,timeoutMs){
 return new Promise((resolve,reject)=>{
  const socket=createConnection(socketPath);let response=Buffer.alloc(0),settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(invalid()),timeoutMs);
  socket.once('connect',()=>socket.write(payload));
  socket.on('data',chunk=>{
   if(response.length+chunk.length>1024)return finish(invalid());
   response=Buffer.concat([response,chunk]);const i=response.indexOf(0);
   if(i!==-1){
    if(i!==response.length-1)return finish(invalid());
    finish(null,response.subarray(0,i).toString('utf8'));
   }
  });
  socket.once('error',()=>finish(invalid()));
  socket.once('end',()=>finish(invalid()));
  socket.once('close',()=>finish(invalid()));
 });
}
export function createClamdIdentityScanner({socketPath,timeoutMs=20000}={}){
 if(typeof socketPath!=='string'||!isAbsolute(socketPath)||socketPath.includes('\0')||
 !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>20000)throw invalid();
 return {
  async version(){
   const v=await clamdExchange(socketPath,Buffer.from('zVERSION\0'),timeoutMs);
   if(!/^ClamAV [\x20-\x7e]{1,112}$/.test(v)||v.length>120)throw invalid();return v;
  },
  async scan(bytes){
   if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>IDENTITY_MAX_BYTES)throw invalid();
   const chunks=[Buffer.from('zINSTREAM\0')];
   for(let i=0;i<bytes.length;i+=65536){const part=bytes.subarray(i,i+65536),length=Buffer.alloc(4);length.writeUInt32BE(part.length);chunks.push(length,part);}
   chunks.push(Buffer.alloc(4));
   const result=await clamdExchange(socketPath,Buffer.concat(chunks),timeoutMs);
   if(result==='stream: OK')return 'clean';
   if(/^stream: [\x20-\x7e]{1,900} FOUND$/.test(result))return 'malicious';
   return 'inconclusive';
  }
 };
}

export async function processNextIdentityScan({store,storage,scanner}){
 // Do not consume a durable retry just because no scanner is configured/up.
 const version=await scanner.version();
 if(typeof version!=='string'||!/^ClamAV [\x20-\x7e]{1,112}$/.test(version)||version.length>120)throw invalid();
 const job=await store.claimScan();if(job===null)return {status:'idle'};
 if(!job||![job.id,job.leaseId,job.ownerId,job.requestId].every(x=>UUID.test(x??''))||
  !Object.hasOwn(ext,job.mime)||job.objectKey!=='private/'+job.ownerId+'/'+job.requestId+'/'+job.id+'.'+ext[job.mime]||
  !Number.isSafeInteger(job.bytes)||job.bytes<8||job.bytes>IDENTITY_MAX_BYTES||!/^[0-9a-f]{64}$/.test(job.digest??''))throw invalid();
 let verdict='inconclusive';
 try{
  const bytes=await storage.read(job.objectKey);
  if(!Buffer.isBuffer(bytes)||bytes.length!==job.bytes||sha256(bytes)!==job.digest)throw invalid();
  const candidate=await scanner.scan(bytes);
  if(['clean','malicious','inconclusive'].includes(candidate))verdict=candidate;
 }catch{/* provider or integrity error remains quarantined */}
 if(await store.recordScan({uploadId:job.id,leaseId:job.leaseId,digest:job.digest,verdict,scanner:version})!==true)
  throw invalid();
 // No identifiers, paths, scanner signatures, or identity bytes in output.
 return {status:verdict};
}
