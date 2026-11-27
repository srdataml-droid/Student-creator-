import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryConfig,normalizeDiscoveryFilters,getHostedDiscovery} from './hosted-discovery.mjs';
const ref='jnkqmlbkkvccnxrgkpno';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:ref,STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',supabase_url:'https://'+ref+'.supabase.co',supabase_publishable_key:'sb_publishable_fixture_only_123'};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=(n=1)=>({id:id(n),course_id:id(100),institution_id:id(200),title:'Math',preview_text:'Public notes',published_at:'2026-01-01T00:00:00Z',status:'published',course:{id:id(100),code:'MTH101',title:'Math',active:true,institution_id:id(200)},institution:{id:id(200),name:'Campus',active:true},creation_key:'private',review_reason:'private'});
test('explicit dedicated staging and public key only',()=>{
 assert.equal(discoveryConfig(env).url,env.supabase_url);
 for(const patch of [{STUDENT_CREATORS_STAGING_APPROVED:'false'},{STUDENT_CREATORS_PUBLIC_REGISTRATION:'true'},{STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'},{supabase_url:'https://other.supabase.co'},{supabase_publishable_key:'sb_secret_fixture_only_123'},{SUPABASE_URL:'https://other.supabase.co'}])assert.throws(()=>discoveryConfig({...env,...patch}));
});
test('strict search and pagination filters',()=>{
 assert.deepEqual(normalizeDiscoveryFilters({q:'  Linear   algebra ',page:'2',courseId:id(100)}),{query:'Linear algebra',page:2,courseId:id(100)});
 for(const input of [{q:'a'},{q:'a,b'},{q:'a*'},{q:'a%'},{q:'a_'},{q:'x'.repeat(81)},{page:'51'},{page:'0'},{page:'1.5'},{courseId:'invalid'},{q:['a','b']}])assert.throws(()=>normalizeDiscoveryFilters(input),/INVALID_DISCOVERY_FILTER/);
});
test('single bounded query with published active filters and stable ordering',async()=>{
 let calls=0;
 const data=await getHostedDiscovery({env,filters:{q:'Math',page:'2',courseId:id(100)},fetcher:async(url,opts)=>{calls++;assert.equal(url.pathname,'/rest/v1/content_items');for(const [k,v]of Object.entries({status:'eq.published','course.active':'eq.true','institution.active':'eq.true',order:'published_at.desc,id.desc',limit:'25',offset:'24',course_id:'eq.'+id(100),or:'(title.ilike.*Math*,preview_text.ilike.*Math*)'}))assert.equal(url.searchParams.get(k),v);assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'error');assert.equal(opts.headers.apikey,env.supabase_publishable_key);assert.equal('authorization' in opts.headers,false);return Response.json([row()]);}});
 assert.equal(calls,1);assert.equal(data.items[0].institutionName,'Campus');assert.equal(data.hasNext,false);assert.equal(JSON.stringify(data).includes('private'),false);assert.equal('priceKobo' in data.items[0],false);
});
test('reject invalid, unpublished, inactive and cross-campus provider rows',async()=>{
 const data=await getHostedDiscovery({env,fetcher:async()=>Response.json([row(),{...row(2),status:'draft'},{...row(3),course:{...row().course,active:false}},{...row(4),institution:{...row().institution,active:false}},{...row(5),institution_id:id(300)},{...row(6),published_at:'invalid'},null])});
 assert.deepEqual(data.items.map(r=>r.id),[id(1)]);
});
test('lookahead, last page and empty data',async()=>{
 const fetcher=async()=>Response.json(Array.from({length:25},(_,i)=>row(i+1)));
 const first=await getHostedDiscovery({env,fetcher});assert.equal(first.items.length,24);assert.equal(first.hasNext,true);
 const last=await getHostedDiscovery({env,filters:{page:'50'},fetcher});assert.equal(last.hasNext,false);
 assert.deepEqual(await getHostedDiscovery({env,fetcher:async()=>Response.json([])}),{items:[],page:1,hasNext:false});
});
test('provider errors and malformed payloads fail closed',async()=>{
 for(const fetcher of [async()=>new Response(null,{status:503}),async()=>Response.json({items:[]}),async()=>Response.json(Array.from({length:26},()=>row())),async()=>{throw Error('network');}])await assert.rejects(getHostedDiscovery({env,fetcher}));
});

test('public content preview queries only the exact published content ID',async()=>{const data=await getHostedDiscovery({env,contentId:id(1),fetcher:async(url)=>{assert.equal(url.searchParams.get('id'),'eq.'+id(1));return Response.json([row(1),row(2),{...row(1),status:'draft'}]);}});assert.deepEqual(data.items.map(p=>p.id),[id(1)]);await assert.rejects(getHostedDiscovery({env,contentId:'bad'}),/INVALID_DISCOVERY_FILTER/);});

test('Shorts discovery uses explicit format and validated public listing prices',async()=>{const creator=id(300),valid={...row(1),creator_id:creator,content_format:'short',listing:[{content_id:id(1),creator_id:creator,price_kobo:30000,currency:'NGN',state:'active'}]};const d=await getHostedDiscovery({env,format:'short',fetcher:async url=>{assert.equal(url.searchParams.get('content_format'),'eq.short');return Response.json([valid,{...row(2),content_format:'video'},{...row(3),content_format:'short',creator_id:creator,listing:[{content_id:id(3),creator_id:id(301),price_kobo:10000,currency:'NGN',state:'active'}]}]);}});assert.deepEqual(d.items.map(x=>x.id),[id(1),id(3)]);assert.equal(d.items[0].priceKobo,30000);assert.equal(d.items[0].creatorId,creator);assert.equal(d.items[0].contentFormat,'short');assert.equal('priceKobo' in d.items[1],false);await assert.rejects(getHostedDiscovery({env,format:'arbitrary'}),/INVALID_DISCOVERY_FILTER/);});

test('creator aliases use one bounded public request and do not expose private records',async()=>{
 const creator=id(300),other=id(301),calls=[];
 const data=await getHostedDiscovery({env,includeCreators:true,fetcher:async(url,opts)=>{
  calls.push(url.pathname);
  assert.equal(opts.headers.apikey,env.supabase_publishable_key);
  assert.equal('authorization' in opts.headers,false);
  if(url.pathname.endsWith('/content_items'))return Response.json([{...row(1),creator_id:creator},{...row(2),creator_id:creator},{...row(3),creator_id:other}]);
  assert.equal(url.pathname,'/rest/v1/creator_public_profiles');
  assert.equal(url.searchParams.get('select'),'user_id,display_name,handle');
  assert.equal(url.searchParams.get('user_id'),'in.('+creator+','+other+')');
  assert.equal(url.searchParams.get('limit'),'2');
  return Response.json([{user_id:creator,display_name:'Public creator',handle:'creator',private_email:'must-not-leak'},{user_id:id(999),display_name:'Unrelated profile',handle:'unrelated'}]);
 }});
 assert.deepEqual(calls,['/rest/v1/content_items','/rest/v1/creator_public_profiles']);
 assert.equal(data.items[0].displayName,'Public creator');
 assert.equal(data.items[1].handle,'creator');
 assert.equal('displayName' in data.items[2],false);
 assert.equal(JSON.stringify(data).includes('must-not-leak'),false);
 assert.equal(JSON.stringify(data).includes('Unrelated profile'),false);
});
test('public alias failure preserves available catalog content without inventing a name',async()=>{
 const data=await getHostedDiscovery({env,includeCreators:true,fetcher:async(url)=>url.pathname.endsWith('/content_items')?Response.json([{...row(),creator_id:id(300)}]):new Response(null,{status:503})});
 assert.equal(data.items.length,1);
 assert.equal('displayName' in data.items[0],false);
});

test('saved metadata only returns requested published content IDs',async()=>{
 const data=await getHostedDiscovery({env,contentIds:[id(1),id(2)],fetcher:async url=>{
  assert.equal(url.searchParams.get('id'),'in.('+id(1)+','+id(2)+')');
  return Response.json([row(1),{...row(2),status:'draft'},row(3)]);
 }});
 assert.deepEqual(data.items.map(x=>x.id),[id(1)]);
 assert.equal(data.hasNext,false);
});
test('saved metadata rejects invalid, repeated or excessive IDs and conflicting filters',async()=>{
 for(const options of [{contentIds:[]},{contentIds:[id(1),id(1)]},{contentIds:['bad']},{contentIds:Array.from({length:25},(_,i)=>id(i+1))},{contentIds:[id(1)],contentId:id(2)},{contentIds:[id(1)],filters:{page:'2'}},{contentIds:[id(1)],format:'short'}]){
  await assert.rejects(getHostedDiscovery({env,...options,fetcher:()=>assert.fail('unexpected network request')}),/INVALID_DISCOVERY_FILTER/);
 }
});
