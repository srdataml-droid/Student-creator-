// Real engine smoke test; no provider credentials, no identity bytes, no malware.
// The test database contains a synthetic signature for a harmless ASCII marker.
import assert from 'node:assert/strict';
import {createClamdIdentityScanner,processNextIdentityScan} from '../packages/hosted-core/src/private-identity-scanner.mjs';
import {sha256} from '../packages/hosted-core/src/private-identity-api.mjs';
const socketPath=process.env.CLAMD_SOCKET;
const scanner=createClamdIdentityScanner({socketPath,timeoutMs:10000});
let ready=false;
for(let i=0;i<40;i++){
 try{await scanner.version();ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}
}
assert.ok(ready,'Real clamd engine did not become ready');
const clean=Buffer.from('Worthkind harmless document fixture 2026');
const matched=Buffer.from('Worthkind fixture: WK_CLAMD_SYNTHETIC_SIGNATURE_20261125');
assert.equal(await scanner.scan(clean),'clean');
assert.equal(await scanner.scan(matched),'malicious');
const ownerId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',leaseId='44444444-4444-4444-8444-444444444444';
for(const [bytes,verdict] of [[clean,'clean'],[matched,'malicious']]){
 const job={id,ownerId,requestId,leaseId,mime:'application/pdf',bytes:bytes.length,digest:sha256(bytes),objectKey:'private/'+ownerId+'/'+requestId+'/'+id+'.pdf'};
 let received;
 const result=await processNextIdentityScan({store:{claimScan:async()=>job,recordScan:async value=>{received=value;return true;}},storage:{read:async()=>bytes},scanner});
 assert.equal(result.status,verdict);assert.equal(received.verdict,verdict);assert.equal(received.leaseId,leaseId);
}
console.log('PASS: real clamd Unix socket engine clean/signature match and worker verdict integration (synthetic signatures only).');
