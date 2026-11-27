import test from 'node:test';
import assert from 'node:assert/strict';
import {searchCategory,searchPublicDirectory} from './public-directory-search.mjs';
const ref='jnkqmlbkkvccnxrgkpno',env={APP_DATA_MODE:'hosted',STUDENT_CREATORS_STAGING_APPROVED:'true',STUDENT_CREATORS_PROJECT_REF:ref,STUDENT_CREATORS_PUBLIC_REGISTRATION:'false',STUDENT_CREATORS_REAL_PAYMENT_ENABLED:'false',supabase_url:'https://'+ref+'.supabase.co',supabase_publishable_key:'sb_publishable_fixture_only_123'};
const id='00000000-0000-4000-8000-000000000001';
test('directory searches validate category and query before provider calls',async()=>{
 assert.equal(searchCategory('creators'),'creators');assert.equal(searchCategory(['creators']),'all');
 for(const q of ['a','x*','x, y'])await assert.rejects(searchPublicDirectory({category:'creators',q,env,fetcher:()=>assert.fail('unexpected provider call')}),/INVALID_DISCOVERY_FILTER/);
 assert.deepEqual(await searchPublicDirectory({category:'creators',env,fetcher:()=>assert.fail('unexpected provider call')}),[]);
});
test('creator results contain public aliases only',async()=>{
 const result=await searchPublicDirectory({category:'creators',q:'Ada',env,fetcher:async(url,opts)=>{
 assert.equal(url.pathname,'/rest/v1/creator_public_profiles');assert.equal(url.searchParams.get('select'),'user_id,display_name,handle');assert.equal(url.searchParams.get('limit'),'50');assert.equal('authorization' in opts.headers,false);
 return Response.json([{user_id:id,display_name:'Ada',handle:'ada',email:'private@example.com'},null,{user_id:'bad',display_name:'Other',handle:'other'}]);}});
 assert.deepEqual(result,[{id,title:'Ada',subtitle:'@ada'}]);
});
test('community search rejects inactive results and reports provider failures',async()=>{
 const result=await searchPublicDirectory({category:'communities',q:'Math',env,fetcher:async(url)=>{assert.equal(url.pathname,'/rest/v1/courses');assert.equal(url.searchParams.get('active'),'eq.true');return Response.json([{id,title:'Math',code:'MTH101',active:true},{id,title:'Inactive',code:'MTH102',active:false}]);}});
 assert.deepEqual(result,[{id,title:'Math',subtitle:'MTH101'}]);
 await assert.rejects(searchPublicDirectory({category:'communities',q:'Math',env,fetcher:async()=>new Response(null,{status:503})}),/DIRECTORY_UNAVAILABLE/);
});
