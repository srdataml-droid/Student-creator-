import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCreatorSale,allocateCreatorSettlement,CreatorSaleError} from '../src/creator-sales.mjs';

function quote(overrides = {}) {
  return quoteCreatorSale({productId:'lesson_123',creatorId:'student_123',productType:'paid_post',
    amountKobo:20_000,platformFeeBps:1500,feeBearer:'platform',...overrides});
}

test('one payment can be split into creator and platform shares',()=>{
  const q=quote();
  assert.equal(q.platformGrossKobo,3_000);
  assert.equal(q.creatorGrossKobo,17_000);
  assert.ok(Object.isFrozen(q));
});

test('no hidden commission or provider fee bearer default is allowed',()=>{
  assert.throws(()=>quoteCreatorSale({productId:'p',creatorId:'c',productType:'paid_post',amountKobo:20_000,feeBearer:'platform'}),{code:'INVALID_PLATFORM_FEE'});
  assert.throws(()=>quote({feeBearer:undefined}),{code:'INVALID_FEE_BEARER'});
});

test('creator subscription and tutoring are priced separately from free follow',()=>{
  for (const productType of ['creator_subscription','tutoring_session']) {
    assert.equal(quote({productType}).productType,productType);
  }
  assert.throws(()=>quote({productType:'free_follow'}),{code:'INVALID_PRODUCT_TYPE'});
});

test('paid content minimum ₦200 and integer kobo are enforced',()=>{
  for (const amountKobo of [19_999,1,-1,NaN,Infinity,20_000.01,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>quote({amountKobo}),CreatorSaleError);
  }
  assert.equal(quote({amountKobo:20_000}).amountKobo,20_000);
});

test('fee cannot be silently set to all the money or exceed validated bounds',()=>{
  for (const platformFeeBps of [-1,10_000,10_001,1.5,NaN,undefined]) {
    assert.throws(()=>quote({platformFeeBps}),{code:'INVALID_PLATFORM_FEE'});
  }
});

test('platform can explicitly bear provider fee, then net shares conserve',()=>{
  const a=allocateCreatorSettlement(quote(),300);
  assert.deepEqual([a.platformNetKobo,a.creatorNetKobo,a.providerFeeKobo],[2700,17000,300]);
  assert.equal(a.platformNetKobo+a.creatorNetKobo+a.providerFeeKobo,a.grossKobo);
});

test('creator can explicitly bear provider fee; not a hidden debit',()=>{
  const a=allocateCreatorSettlement(quote({feeBearer:'creator'}),300);
  assert.deepEqual([a.platformNetKobo,a.creatorNetKobo,a.creatorFeeShareKobo],[3000,16700,300]);
});

test('proportional provider fee conserves gross for non-round values',()=>{
  const q=quote({amountKobo:20_001,platformFeeBps:3333,feeBearer:'proportional'});
  const a=allocateCreatorSettlement(q,123);
  assert.equal(a.providerFeeKobo,a.creatorFeeShareKobo+a.platformFeeShareKobo);
  assert.equal(a.platformNetKobo+a.creatorNetKobo+a.providerFeeKobo,q.amountKobo);
});

test('invalid provider fee cannot silently create negative creator or platform cash',()=>{
  assert.throws(()=>allocateCreatorSettlement(quote(),3001),{code:'FEE_EXCEEDS_ALLOCATION'});
  assert.throws(()=>allocateCreatorSettlement(quote({feeBearer:'creator'}),17_001),{code:'FEE_EXCEEDS_ALLOCATION'});
  assert.throws(()=>allocateCreatorSettlement(quote(),20_001),{code:'INVALID_QUOTE'});
});

test('malformed or mutated quote is rejected instead of reallocating silently',()=>{
  const altered={...quote(),platformGrossKobo:999};
  assert.throws(()=>allocateCreatorSettlement(altered,0),{code:'INVALID_QUOTE'});
  assert.throws(()=>allocateCreatorSettlement(null,0),{code:'INVALID_QUOTE'});
});

test('exact ₦200 with zero platform commission has no undefined fraction',()=>{
  const q=quote({platformFeeBps:0,feeBearer:'creator'});
  const a=allocateCreatorSettlement(q,200);
  assert.equal(a.creatorNetKobo,19_800);
  assert.equal(a.platformNetKobo,0);
});

test('invalid party identities cannot enter the quote',()=>{
  assert.throws(()=>quote({creatorId:''}),{code:'INVALID_PARTIES'});
  assert.throws(()=>quote({productId:'unsafe content'}),{code:'INVALID_PARTIES'});
});


test('large safe-integer amounts cannot overflow proportional rounding',()=>{
  const q=quote({amountKobo:5_000_000_001,platformFeeBps:3333,feeBearer:'proportional'});
  const a=allocateCreatorSettlement(q,200_000);
  assert.equal(a.platformNetKobo+a.creatorNetKobo+a.providerFeeKobo,q.amountKobo);
  assert.equal(a.platformFeeShareKobo+a.creatorFeeShareKobo,a.providerFeeKobo);
});
