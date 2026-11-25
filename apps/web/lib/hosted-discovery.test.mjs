import test from 'node:test';
import assert from 'node:assert/strict';
import {getHostedDiscovery,filterHostedPreviews} from './hosted-discovery.mjs';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const ref='jnkqmlbkkvccnxrgkpno';
const env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:ref,STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',supabase_url:'https://'+ref+'.supabase.co',supabase_publishable_key:'sb_publishable_fixture_only_123'};
const row={id:ids[0],creator_id:ids[1],course_id:ids[2],institution_id:ids[3],title:'Calculus',description:'Original',preview_text:'Public excerpt',published_at:'2026-11-25',status:'published',lesson_text:'PRIVATE',review_reason:'PRIVATE'};
function fixture(calls,rows=[row]){
 return async(url,opts)=>{calls.push({url,opts});const table=url.pathname.split('/').pop();return Response.json(table==='content_items'?rows:table==='courses'?[{id:ids[2],institution_id:ids[3],code:'MTH101',title:'Math',active:true}]:[{id:ids[3],name:'Campus',active:true}]);};
}
test('published previews only, no guessed price or video, no private fields',async()=>{
 const calls=[];const result=await getHostedDiscovery({env,fetcher:fixture(calls,[row,{...row,status:'draft'},{...row,institution_id:ids[0]}])});
 assert.equal(result.posts.length,1);assert.equal(result.posts[0].title,'Calculus');assert.equal(result.posts[0].institutionName,'Campus');
 assert.equal('priceKobo' in result.posts[0],false);assert.equal('hasVideo' in result.posts[0],false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 for(const {opts} of calls){assert.equal(opts.headers.apikey,env.supabase_publishable_key);assert.equal(opts.headers.authorization,undefined);assert.equal(opts.cache,'no-store');}
 assert.equal(calls[0].url.searchParams.get('status'),'eq.published');
 assert.equal(filterHostedPreviews(result.posts,{q:'mth101',institutionId:ids[3]}).length,1);
 assert.equal(filterHostedPreviews(result.posts,{q:'not present'}).length,0);
});
test('missing config and provider failures are not empty success',async()=>{
 await assert.rejects(()=>getHostedDiscovery({env:{}}),/CATALOG_NOT_CONFIGURED/);
 await assert.rejects(()=>getHostedDiscovery({env,fetcher:async()=>new Response('',{status:503})}),/CATALOG_UNAVAILABLE/);
});
test('detail lookup validates id and excludes mismatched results',async()=>{
 const calls=[];assert.deepEqual(await getHostedDiscovery({env,lessonId:'invalid',fetcher:fixture(calls)}),{posts:[],courses:[],schools:[]});assert.equal(calls.length,0);
 const data=await getHostedDiscovery({env,lessonId:ids[0],fetcher:fixture(calls,[row,{...row,id:ids[1]}])});
 assert.equal(data.posts.length,1);assert.equal(calls[0].url.searchParams.get('id'),'eq.'+ids[0]);
});

test('discovery denies unapproved projects and privileged credentials before requests',async()=>{
 for(const patch of [{STUDENT_CREATORS_STAGING_APPROVED:'false'},{STUDENT_CREATORS_PUBLIC_REGISTRATION:'true'},{STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'true'},{supabase_url:'https://another.supabase.co'},{supabase_publishable_key:'sb_secret_fixture_only_123'}]){let calls=0;await assert.rejects(getHostedDiscovery({env:{...env,...patch},fetcher:async()=>{calls++;throw Error('must not request');}}));assert.equal(calls,0);}
});
