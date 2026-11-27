import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayoutBankProvider,buildLivePayoutBankProvider} from '../src/payout-bank-provider.mjs';

const fixtureBank={code:'058',name:'Fixture Bank',country:'Nigeria',currency:'NGN',type:'nuban',active:true,is_deleted:false};
const accountNumber='0123456789',bankCode='058',recipientCode='RCP_fixture12345';
const data={recipient_code:recipientCode,domain:'test',currency:'NGN',type:'nuban',active:true,is_deleted:false,details:{account_number:accountNumber,bank_code:bankCode,private:'not returned'}};
const response=x=>Response.json({status:true,...x});
function fixture(replies){
 const calls=[];
 const provider=createPayoutBankProvider({key:'sk_test_fixture123',environment:'test',fetcher:async(url,options)=>{calls.push({url,options});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;}});
 return {provider,calls};
}
test('bank list paginates, filters inactive and non-Nigerian institutions, returns minimal data',async()=>{
 const {provider,calls}=fixture([response({data:[fixtureBank,{...fixtureBank,code:'011',active:false}],meta:{next:'abc='}}),response({data:[{...fixtureBank,code:'999992',name:'Fixture Wallet'}, {...fixtureBank,currency:'GHS'}],meta:{next:null}})]);
 assert.deepEqual(await provider.listBanks(),[{code:'058',name:'Fixture Bank'},{code:'999992',name:'Fixture Wallet'}]);
 assert.equal(calls.length,2);assert.equal(calls[1].url.searchParams.get('next'),'abc=');assert.equal(calls[0].url.origin,'https://api.paystack.co');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');
});
test('bank list refuses partial, looping or conflicting provider catalog',async()=>{
 for(const replies of [[response({data:[fixtureBank]})],[response({data:[fixtureBank],meta:{next:'abc'}}),response({data:[fixtureBank],meta:{next:'abc'}})],[response({data:[fixtureBank,{...fixtureBank,name:'Other'}],meta:{next:null}})]]){
  await assert.rejects(fixture(replies).provider.listBanks(),{code:'PAYOUT_BANK_PROVIDER_UNAVAILABLE'});
 }
});
test('account lookup preserves leading zeros, masks account and rejects invalid input before provider call',async()=>{
 const {provider,calls}=fixture([response({data:{account_number:accountNumber,account_name:'Fixture Person',bank_id:1}})]);
 assert.deepEqual(await provider.resolveAccount({bankCode,accountNumber}),{bankCode,accountLast4:'6789',accountName:'Fixture Person'});
 assert.equal(calls[0].url.pathname,'/bank/resolve');assert.equal(calls[0].url.searchParams.get('account_number'),accountNumber);
 for(const patch of [{accountNumber:123456789},{accountNumber:'012345678'}, {bankCode:'../transfer'},{bankCode:58}])await assert.rejects(provider.resolveAccount({bankCode,accountNumber,...patch}),{code:'INVALID_PAYOUT_BANK_INPUT'});
 assert.equal(calls.length,1);
});
test('wrong account and provider errors fail with no provider payload leakage',async()=>{
 for(const reply of [response({data:{account_number:'9999999999',account_name:'Private'}}),new Error('private upstream error'),new Response('private upstream error',{status:429}),response({data:{account_number:accountNumber,account_name:'bad\nname'}})]){
  await assert.rejects(fixture([reply]).provider.resolveAccount({bankCode,accountNumber}),{message:'PAYOUT_BANK_PROVIDER_UNAVAILABLE'});
 }
});
test('recipient validation checks environment, active status, exact bank and account; no sensitive fields returned',async()=>{
 const {provider,calls}=fixture([response({data})]);
 assert.deepEqual(await provider.verifyRecipient({recipientCode,bankCode,accountNumber}),{recipientCode,bankCode,accountLast4:'6789',providerVerified:true});
 assert.equal(calls[0].url.pathname,'/transferrecipient/'+recipientCode);
 for(const patch of [{domain:'live'},{active:false},{is_deleted:true},{currency:'USD'},{type:'mobile_money'},{recipient_code:'RCP_other1234'},{details:{account_number:'9999999999',bank_code:bankCode}},{details:{account_number:accountNumber,bank_code:'011'}}]){
  await assert.rejects(fixture([response({data:{...data,...patch}})]).provider.verifyRecipient({recipientCode,bankCode,accountNumber}),{code:'PAYOUT_BANK_PROVIDER_UNAVAILABLE'});
 }
});
test('wrong mode keys and unapproved live configuration fail closed',()=>{
 assert.throws(()=>createPayoutBankProvider({key:'sk_test_fixture',environment:'live'}),{code:'PAYOUT_BANK_PROVIDER_UNAVAILABLE'});
 assert.throws(()=>buildLivePayoutBankProvider({env:{}}),{code:'PAYOUT_BANK_PROVIDER_UNAVAILABLE'});
});
