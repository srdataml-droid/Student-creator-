import test from 'node:test';
import assert from 'node:assert/strict';
import {sealPayoutBank,openPayoutBank} from '../src/payout-bank-crypto.mjs';
const secret='ab'.repeat(32),actor='da110000-0000-4000-8000-000000000001',id='da130000-0000-4000-8000-000000000001',value={bankCode:'058',accountNumber:'0123456789',accountName:'Fixture Person'};
test('AES-GCM bank envelope is randomized, authenticated and bound to actor and request',()=>{
 const envelope=sealPayoutBank({secret,actor,id,value});
 assert.notEqual(envelope,sealPayoutBank({secret,actor,id,value}));assert.ok(!envelope.includes(value.accountNumber));assert.ok(!envelope.includes(value.accountName));
 assert.deepEqual(openPayoutBank({secret,actor,id,envelope}),value);
 for(const patch of [{actor:id},{id:actor},{secret:'cd'.repeat(32)},{envelope:envelope.slice(0,-2)+(envelope.endsWith('00')?'11':'00')}])assert.throws(()=>openPayoutBank({secret,actor,id,envelope,...patch}),{message:'PAYOUT_BANK_ENCRYPTION_UNAVAILABLE'});
});
test('bank encryption rejects malformed input, extra data and invalid keys',()=>{
 for(const patch of [{secret:'weak'},{value:{...value,pin:'1234'}},{value:{...value,accountNumber:123}},{value:{...value,accountName:'bad\nname'}}])assert.throws(()=>sealPayoutBank({secret,actor,id,value,...patch}),{message:'PAYOUT_BANK_ENCRYPTION_UNAVAILABLE'});
});
