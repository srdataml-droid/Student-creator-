import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayoutBankHandler} from '../src/payout-bank-http.mjs';
const origin='https://creator.example.invalid';
const actor='da110000-0000-4000-8000-000000000001',session='da130000-0000-4000-8000-000000000001';
const token='fixture.'+Buffer.from(JSON.stringify({sub:actor,session_id:session})).toString('base64url')+'.signature';
const valid={bankCode:'058',accountNumber:'0123456789',consent:true};
function request(body=valid,headers={},method='POST'){
 return new Request(origin+'/api/account/payout-bank/resolve',{method,headers:{origin,authorization:'Bearer '+token,'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
function fixture({user={id:actor},allow=true,fail=false}={}){
 const calls=[];
 const handler=createPayoutBankHandler({buildRuntime:()=>({origin,auth:{getUser:async t=>{calls.push(['auth',t]);return user;}},admit:async(...x)=>{calls.push(['admit',...x]);return allow;},provider:{listBanks:async()=>{calls.push(['banks']);return [{code:'058',name:'Fixture'}];},resolveAccount:async x=>{calls.push(['resolve',x]);if(fail)throw Error('secret account payload');return {bankCode:x.bankCode,accountLast4:'6789',accountName:'Fixture Person',private:'must not leak'};}}})});
 return {handler,calls};
}
test('authenticated resolution binds admission to verified actor and session and masks the response',async()=>{
 const {handler,calls}=fixture();
 const res=await handler(request(),'resolve');
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{bankCode:'058',accountLast4:'6789',accountName:'Fixture Person',ownershipVerified:false});
 assert.deepEqual(calls,[['auth',token],['admit',actor,session,'resolve'],['resolve',{bankCode:'058',accountNumber:'0123456789'}]]);
 assert.match(res.headers.get('cache-control'),/no-store/);
});
test('origin, invalid inputs, consent and injected identity are rejected before provider access',async()=>{
 for(const [body,headers,status] of [[valid,{origin:'https://wrong.invalid'},403],[{...valid,consent:false},{},422],[{...valid,userId:actor},{},422],[{...valid,recipientCode:'RCP_bad'},{},422],[{...valid,accountNumber:123},{},422],[valid,{authorization:''},401]]){
  const {handler,calls}=fixture();assert.equal((await handler(request(body,headers),'resolve')).status,status);assert.equal(calls.length,0);
 }
});
test('missing session, wrong subject and denied admission fail before bank data is requested',async()=>{
 for(const [options,status,count] of [[{user:null},403,1],[{user:{id:'da110000-0000-4000-8000-000000000002'}},403,1],[{allow:false},429,2]]){
  const {handler,calls}=fixture(options);assert.equal((await handler(request(),'resolve')).status,status);assert.equal(calls.length,count);
 }
});
test('provider errors redact response and disabled runtime fails closed',async()=>{
 const {handler}=fixture({fail:true});const res=await handler(request(),'resolve');assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'PAYOUT_BANK_UNAVAILABLE'});
 const disabled=createPayoutBankHandler({env:{},fetcher:()=>{throw Error('must not call');}});assert.equal((await disabled(request(),'resolve')).status,503);
});
test('bank catalog is authorized and only the two read operations are exposed',async()=>{
 const {handler,calls}=fixture();const res=await handler(request({}),'banks');assert.deepEqual(await res.json(),{banks:[{code:'058',name:'Fixture'}]});assert.deepEqual(calls.slice(1),[['admit',actor,session,'banks'],['banks']]);
 assert.equal((await handler(request(),'create-recipient')).status,404);
 assert.equal((await handler(request({}, {},'GET'),'banks')).status,405);
});
