import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDiscoveryFilters,getPagedHostedDiscovery} from './paged-hosted-discovery.mjs';
const ref='jnkqmlbkkvccnxrgkpno';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:ref,STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',supabase_url:'https://'+ref+'.supabase.co',supabase_publishable_key:'sb_publishable_fixture_only_123'};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=(n=1)=>({id:id(n),creator_id:id(300),course_id:id(100),institution_id:id(200),title:'Math',preview_text:'Public notes',published_at:'2026-01-01T00:00:00Z',status:'published',course:{id:id(100),code:'MTH101',title:'Math',active:true,institution_id:id(200)},institution:{id:id(200),name:'Campus',active:true},creation_key:'private',review_reason:'private'});
test('strict search and pagination filters',()=>{
 assert.deepEqual(normalizeDiscoveryFilters({q:'  Linear   algebra ',page:'2',courseId:id(100)}),{query:'Linear algebra',page:2,courseId:id(100),institutionId:''});
 for(const input of [{q:'a'},{q:'a,b'},{q:'a*'},{q:'a%'},{q:'a_'},{q:'x'.repeat(81)},{page:'51'},{page:'0'},{page:'1.5'},{courseId:'invalid'},{q:['a','b']}])assert.throws(()=>normalizeDiscoveryFilters(input),/INVALID_DISCOVERY_FILTER/);
});
test('single bounded query with published active filters and stable ordering',async()=>{
 let calls=0;
 const data=await getPagedHostedDiscovery({env,filters:{q:'Math',page:'2',courseId:id(100)},fetcher:async(url,opts)=>{calls++;assert.equal(url.pathname,'/rest/v1/content_items');for(const [k,v]of Object.entries({status:'eq.published','course.active':'eq.true','institution.active':'eq.true',order:'published_at.desc,id.desc',limit:'25',offset:'24',course_id:'eq.'+id(100),or:'(title.ilike.*Math*,description.ilike.*Math*,preview_text.ilike.*Math*)'}))assert.equal(url.searchParams.get(k),v);assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'error');assert.equal(opts.headers.apikey,env.supabase_publishable_key);assert.equal('authorization' in opts.headers,false);return Response.json([row()]);}});
 assert.equal(calls,1);assert.equal(data.items[0].institutionName,'Campus');assert.equal(data.hasNext,false);assert.equal(JSON.stringify(data).includes('private'),false);assert.equal('priceKobo' in data.items[0],false);
});
test('reject invalid, unpublished, inactive and cross-campus provider rows',async()=>{
 const data=await getPagedHostedDiscovery({env,fetcher:async()=>Response.json([row(),{...row(2),status:'draft'},{...row(3),course:{...row().course,active:false}},{...row(4),institution:{...row().institution,active:false}},{...row(5),institution_id:id(300)},{...row(6),published_at:'invalid'},null])});
 assert.deepEqual(data.items.map(r=>r.id),[id(1)]);
});
test('lookahead, last page and empty data',async()=>{
 const fetcher=async()=>Response.json(Array.from({length:25},(_,i)=>row(i+1)));
 const first=await getPagedHostedDiscovery({env,fetcher});assert.equal(first.items.length,24);assert.equal(first.hasNext,true);
 const last=await getPagedHostedDiscovery({env,filters:{page:'50'},fetcher});assert.equal(last.hasNext,false);
 assert.deepEqual(await getPagedHostedDiscovery({env,fetcher:async()=>Response.json([])}),{items:[],page:1,hasNext:false});
});
test('provider errors and malformed payloads fail closed',async()=>{
 for(const fetcher of [async()=>new Response(null,{status:503}),async()=>Response.json({items:[]}),async()=>Response.json(Array.from({length:26},()=>row())),async()=>{throw Error('network');}])await assert.rejects(getPagedHostedDiscovery({env,fetcher}));
});

test('direct detail and campus filter never depend on directory limits',async()=>{let calls=0;const result=await getPagedHostedDiscovery({env,lessonId:id(1),filters:{institutionId:id(200)},fetcher:async(url)=>{calls++;assert.equal(url.searchParams.get('id'),'eq.'+id(1));assert.equal(url.searchParams.get('institution_id'),'eq.'+id(200));return Response.json([row()]);}});assert.equal(calls,1);assert.equal(result.items[0].id,id(1));assert.equal(result.hasNext,false);});
test('unapproved runtime does not make network requests',async()=>{let calls=0;await assert.rejects(getPagedHostedDiscovery({env:{...env,STUDENT_CREATORS_STAGING_APPROVED:'false'},fetcher:async()=>{calls++;}}));assert.equal(calls,0);});
