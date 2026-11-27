import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayoutBankWorkflowHandler} from '../src/payout-bank-workflow-http.mjs';
import {sealPayoutBank,openPayoutBank} from '../src/payout-bank-crypto.mjs';
const actor='da110000-0000-4000-8000-000000000001',id='da130000-0000-4000-8000-000000000001',staff='da110000-0000-4000-8000-000000000002',lease='da130000-0000-4000-8000-000000000002';
const origin='https://creator.example.invalid',secret='ab'.repeat(32),value={bankCode:'058',accountNumber:'0123456789',accountName:'Fixture Person'};
function request(input,user=actor,extra={}){
 const token='fixture.'+Buffer.from(JSON.stringify({sub:user,session_id:user})).toString('base64url')+'.signature';
 return new Request(origin+'/api/account/payout-bank-workflow/submit',{method:'POST',headers:{origin,authorization:'Bearer '+token,'content-type':'application/json',...extra},body:JSON.stringify(input)});
}
function fixture({approved=true,providerFails=false,claim=true}={}){
 const calls=[],envelope=sealPayoutBank({secret,actor,id,value});
 const handler=createPayoutBankWorkflowHandler({newId:()=>id,runtime:(_e,_f,isStaff)=>({origin,secret,registrationApproved:approved,auth:{getUser:async()=>({id:isStaff?staff:actor})},provider:{resolveAccount:async args=>{calls.push(['resolve',args]);return {bankCode:'058',accountLast4:'6789',accountName:value.accountName};},verifyRecipient:async args=>{calls.push(['verify',args]);return {bankCode:'058',accountLast4:'6789',recipientCode:args.recipientCode,providerVerified:true};},createRecipient:async args=>{calls.push(['create',args]);if(providerFails)throw Error('sensitive error');return {bankCode:'058',accountLast4:'6789',recipientCode:'RCP_fixture12345',providerVerified:true};}},rpc:async(name,args)=>{
 calls.push([name,args]);switch(name){case 'admit_creator_bank_lookup':return true;case 'creator_bank_submission':return {id,state:'pending'};case 'staff_bank_recovery_claim':case 'staff_bank_claim':return claim?{id,creatorId:actor,lease,envelope}:null;case 'staff_bank_finish':return args._recipient!==null;case 'staff_bank_details':return {id,creatorId:actor,envelope};case 'staff_bank_review':return true;default:return [];}
 }})});
 return {handler,calls};
}
test('submission resolves consented account and persists encrypted actor-bound data only',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(request({bankCode:value.bankCode,accountNumber:value.accountNumber,consent:true}),'submit');
 assert.equal(response.status,201);assert.deepEqual(await response.json(),{id,state:'pending'});
 const args=calls[2][1];assert.equal(calls[0][0],'admit_creator_bank_lookup');assert.equal(args._actor,actor);assert.equal(args._last4,'6789');assert.ok(!JSON.stringify(args).includes(value.accountNumber));assert.deepEqual(openPayoutBank({secret,actor,id,envelope:args._envelope}),value);
});
test('client cannot submit reviewer identity, raw evidence, recipient or account name',async()=>{
 const {handler,calls}=fixture();
 for(const input of [{bankCode:'058',accountNumber:value.accountNumber,consent:true,accountName:'Other'},{bankCode:'058',accountNumber:value.accountNumber,consent:false},{id,decision:'approve',evidence:'fixture-evidence',actorId:actor}])assert.equal((await handler(request(input),input.id?'review':'submit')).status,422);
 assert.equal((await handler(request({id},staff,{origin:'https://other.invalid'}),'details')).status,403);
 assert.equal(calls.length,0);
});
test('registration only uses durable claim data and verifies recipient before finalization',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(request({id},staff),'register');assert.equal(response.status,200);assert.deepEqual(await response.json(),{registered:true});
 assert.deepEqual(calls.map(x=>x[0]),['staff_bank_claim','create','staff_bank_finish']);assert.equal(calls[2][1]._lease,lease);assert.equal(calls[2][1]._recipient,'RCP_fixture12345');
});
test('disabled registration, rejected claim and uncertain provider call cannot trigger retry',async()=>{
 for(const options of [{approved:false},{claim:false},{providerFails:true}]){
  const {handler,calls}=fixture(options),res=await handler(request({id},staff),'register');assert.notEqual(res.status,200);
  assert.equal(calls.filter(x=>x[0]==='create').length,options.providerFails?1:0);
  if(options.providerFails)assert.equal(calls.at(-1)[1]._recipient,null);
 }
});
test('audited details return only decrypted account information with no-cache',async()=>{
 const {handler,calls}=fixture();
 const res=await handler(request({id},staff),'details');assert.deepEqual(await res.json(),{id,creatorId:actor,...value});assert.match(res.headers.get('cache-control'),/no-store/);assert.equal(calls[0][0],'staff_bank_details');
});

test('recovery verifies a previously existing recipient, never repeats creation',async()=>{
 const {handler,calls}=fixture();
 const res=await handler(request({id,recipientCode:'RCP_fixture12345'},staff),'recover');
 assert.equal(res.status,200);
 assert.deepEqual(calls.map(x=>x[0]),['staff_bank_recovery_claim','verify','staff_bank_finish']);
 assert.equal(calls[2][1]._recipient,'RCP_fixture12345');
});
test('unclaimed recovery does not access provider',async()=>{
 const {handler,calls}=fixture({claim:false});
 assert.equal((await handler(request({id,recipientCode:'RCP_fixture12345'},staff),'recover')).status,409);
 assert.deepEqual(calls.map(x=>x[0]),['staff_bank_recovery_claim']);
});
