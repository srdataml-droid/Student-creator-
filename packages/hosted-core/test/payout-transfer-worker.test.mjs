import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaystackTransferProvider,processPayoutTransfer,buildPayoutTransferWorker} from '../src/payout-transfer-worker.mjs';
const job={id:'11111111-1111-4111-8111-111111111111',lease:'22222222-2222-4222-8222-222222222222',reference:'pt_'+'a'.repeat(32),recipientCode:'RCP_fixture1234',amountKobo:10000,dispatch:true};
const data={reference:job.reference,domain:'live',currency:'NGN',source:'balance',amount:job.amountKobo,recipient:{recipient_code:job.recipientCode,domain:'live',currency:'NGN'},transfer_code:'TRF_fixture1234',status:'success',fee_charged:100};
test('real Paystack endpoint contract binds amount, recipient, reference, environment and fee',async()=>{
 const calls=[];const provider=createPaystackTransferProvider({key:'sk_live_fixture',fetcher:async(url,o)=>{calls.push({url:String(url),options:o});return Response.json({status:true,data});}});
 await provider.initiate(job);const result=await provider.verify(job);
 assert.equal(calls[0].url,'https://api.paystack.co/transfer');assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),{source:'balance',currency:'NGN',amount:10000,recipient:job.recipientCode,reference:job.reference,reason:'Creator earnings payout'});
 assert.equal(calls[1].url,'https://api.paystack.co/transfer/verify/'+job.reference);assert.deepEqual(result,{status:'success',code:data.transfer_code,fee:100});
 for(const changed of [{amount:999},{domain:'test'},{reference:'other'},{recipient:{...data.recipient,recipient_code:'RCP_other123456'}},{fee_charged:null}]){
  const p=createPaystackTransferProvider({key:'sk_live_fixture',fetcher:async()=>Response.json({status:true,data:{...data,...changed}})});await assert.rejects(p.verify(job));
 }
});
test('uncertain POST is never retried; a later lease verifies only',async()=>{
 let claimed=job,posts=0,gets=0,records=[];
 const store={claim:async()=>claimed,record:async(j,o)=>{records.push(o);return true;}};
 const provider={initiate:async()=>{posts++;throw Error('timeout');},verify:async()=>{gets++;if(gets===1)throw Error('unavailable');return {status:'success',code:data.transfer_code,fee:100};}};
 assert.deepEqual(await processPayoutTransfer({store,provider,allowDispatch:true}),{state:'retry'});
 claimed={...job,dispatch:false};assert.deepEqual(await processPayoutTransfer({store,provider,allowDispatch:false}),{state:'processed'});
 assert.equal(posts,1);assert.equal(gets,2);assert.equal(records[0].status,'unknown');
});
test('dispatch is denied without explicit flag and disabled worker performs no provider request',async()=>{
 let calls=0;const store={claim:async()=>job,record:async()=>{calls++;}};const provider={initiate:async()=>{calls++;},verify:async()=>{calls++;}};
 await assert.rejects(processPayoutTransfer({store,provider}));assert.equal(calls,0);
 assert.throws(()=>buildPayoutTransferWorker({env:{},fetcher:async()=>{calls++;}}));assert.equal(calls,0);
});
