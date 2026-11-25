import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceReadHandler,financeReadConfig} from './hosted-finance-read.mjs';
const id='11111111-1111-4111-8111-111111111111',content='22222222-2222-4222-8222-222222222222',order='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const request=(url='https://student.example/api/account/purchases',token='one.two.three')=>new Request(url,{headers:{authorization:'Bearer '+token}});
const cfg=()=>({url:'https://example.supabase.co',publishableKey:'test-public-key'});
function fixture(calls,{foreign=false,revoked=false}={}){
 return async(url,opts)=>{calls.push({url,opts});const p=url.pathname;
 if(p==='/auth/v1/user')return Response.json({id,email_confirmed_at:'2026-11-25'});
 if(p.endsWith('/student_profiles'))return Response.json(revoked?[]:[{user_id:id,suspended:false}]);
 if(p.endsWith('/listings'))return Response.json([{content_id:content,price_kobo:20000,currency:'NGN',state:'active'}]);
 if(p.endsWith('/orders'))return Response.json([{id:order,buyer_id:foreign?other:id,content_id:content,amount_kobo:20000,currency:'NGN',environment:'test',status:'paid',created_at:'2026-11-25T10:00:00Z',private:'never return'}]);
 if(p.endsWith('/entitlements'))return Response.json([{buyer_id:id,order_id:order,content_id:content,state:'active',expires_at:null}]);
 throw Error('unexpected request');
 };
}
test('buyer read uses current own profile and bearer-only RLS, returns minimal history',async()=>{
 const calls=[];const r=await createFinanceReadHandler({config:cfg,fetcher:fixture(calls)})(request());
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 const result=await r.json();assert.equal(result.orders[0].accessRecorded,true);assert.equal(result.orders[0].environment,'test');assert.equal('private' in result.orders[0],false);
 for(const {opts} of calls){assert.equal(opts.headers.authorization,'Bearer one.two.three');assert.equal(opts.headers.apikey,'test-public-key');assert.equal(opts.method,'GET');}
 for(const {url} of calls.filter(c=>/orders|entitlements/.test(c.url.pathname)))assert.equal(url.searchParams.get('buyer_id'),'eq.'+id);
});
test('denies foreign data, revoked session, unauthenticated and caller-selected buyer',async()=>{
 const calls=[];const f=fixture(calls,{foreign:true});
 assert.equal((await createFinanceReadHandler({config:cfg,fetcher:f})(request())).status,503);
 assert.equal((await createFinanceReadHandler({config:cfg,fetcher:fixture([],{revoked:true})})(request())).status,403);
 assert.equal((await createFinanceReadHandler({config:cfg,fetcher:f})(request('https://student.example/api/account/purchases?buyer_id='+other))).status,400);
 assert.equal((await createFinanceReadHandler({config:cfg,fetcher:f})(new Request('https://student.example/api/account/purchases'))).status,401);
});
test('quote is read-only and scoped to the selected active listing',async()=>{
 const calls=[];const r=await createFinanceReadHandler({config:cfg,fetcher:fixture(calls),lessonId:content})(request());
 assert.deepEqual(await r.json(),{priceKobo:20000,currency:'NGN'});
 assert.equal(calls.at(-1).url.searchParams.get('content_id'),'eq.'+content);
 assert.equal((await createFinanceReadHandler({config:cfg,fetcher:fixture([]),lessonId:other})(request())).status,404);
 assert.throws(()=>financeReadConfig({}));
});
