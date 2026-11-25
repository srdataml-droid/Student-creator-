import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDraftKey,parseAccessPrice,mediaSelectionError,submissionBlock} from './studio-workflow.mjs';
test('draft keys are cryptographically random, fail closed, never shared constants',()=>{
 assert.notEqual(makeDraftKey(),makeDraftKey());
 assert.throws(()=>makeDraftKey({}),/SECURE_RANDOM_UNAVAILABLE/);
 assert.match(makeDraftKey({getRandomValues:a=>a.fill(42)}),/^[a-f0-9]{48}$/);
});
test('access price rejects empty, fractional, exponent, negative and under-minimum input',()=>{
 for(const bad of ['', ' ', '1e3', '200.5', '-1', '199','10000001',null])assert.equal(parseAccessPrice(bad),null);
 for(const [input,expected] of [['0',0],['200',20000],[' 500 ',50000],['10000000',1000000000]])assert.equal(parseAccessPrice(input),expected);
});
test('media validation handles empty video, size and captions constraints',()=>{
 assert.equal(mediaSelectionError({type:'video/mp4',size:0},'video')!==null,true);
 assert.equal(mediaSelectionError({type:'video/mp4',size:25*1024*1024},'video'),null);
 assert.notEqual(mediaSelectionError({type:'video/mp4',size:25*1024*1024+1},'video'),null);
 assert.notEqual(mediaSelectionError({name:'x.txt',size:100},'captions'),null);
 assert.equal(mediaSelectionError({name:'x.VTT',size:100},'captions'),null);
});
test('submission requires saved edits, price and uploads; unrelated edit does not block',()=>{
 const item={id:'a',priceKobo:20000};
 assert.equal(submissionBlock({item,priceInput:'200'}),null);
 assert.equal(submissionBlock({item,editingId:'b'}),null);
 for(const extra of [{editingId:'a'},{priceInput:''},{priceInput:'300'},{videoFile:{}},{captionFile:{}}])assert.ok(submissionBlock({item,...extra}));
});
