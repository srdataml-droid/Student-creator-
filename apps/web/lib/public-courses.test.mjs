import test from 'node:test';
import assert from 'node:assert/strict';
import {getPublicCourses,getPublicCourse} from './public-courses.mjs';
const id='33333333-3333-4333-8333-333333333333';
test('directory does not invent real courses without env',async()=>{
 assert.deepEqual(await getPublicCourses({env:{}}),{state:'not_configured',courses:[]});
});
test('directory filters inactive and malformed courses and limits fields',async()=>{
 const seen=[];const fetcher=async(url,options)=>{seen.push({url:String(url),options});return Response.json([{id,active:true,code:'MTH 101',title:'Calculus',institution_id:'university',department_id:'math',secret:'NEVER'},{id:'invalid',active:true},{id,active:false}]);};
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public'};
 const data=await getPublicCourses({env,fetcher});assert.equal(data.courses.length,1);assert.equal(data.courses[0].code,'MTH 101');assert.equal('secret' in data.courses[0],false);assert.equal(seen[0].options.headers.apikey,'public');assert.equal('authorization' in seen[0].options.headers,false);
 assert.equal((await getPublicCourse({id,env,fetcher})).title,'Calculus');
});
test('invalid course ID does not make provider request',async()=>{
 const result=await getPublicCourse({id:'bad',fetcher:()=>{throw Error('do not fetch');}});assert.equal(result,null);
});
test('remote HTTP URL rejected and provider errors sanitized',async()=>{
 await assert.rejects(()=>getPublicCourses({env:{SUPABASE_URL:'http://evil.example',SUPABASE_PUBLISHABLE_KEY:'abc'}}),/Invalid project URL/);
 await assert.rejects(()=>getPublicCourses({env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public'},fetcher:async()=>new Response('private failure',{status:500})}),/Course provider unavailable/);
});

test('specific course resolves by id independently of the first 50-course directory page',async()=>{
 const id='33333333-3333-4333-8333-333333333333';
 const urls=[];const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public'};
 const fetcher=async(url)=>{urls.push(new URL(url));return Response.json([{id,active:true,code:'CSC 420',title:'Distributed Systems'}]);};
 const result=await getPublicCourse({id,env,fetcher});
 assert.equal(result.code,'CSC 420');assert.equal(urls[0].searchParams.get('id'),`eq.${id}`);
 assert.equal(urls[0].searchParams.get('limit'),'1');
 assert.equal(urls[0].searchParams.has('order'),false);
});

test('Vercel lowercase Supabase settings load actual public catalog via RLS-scoped key',async()=>{
 const ref='jnkqmlbkkvccnxrgkpno';
 const env={supabase_url:'https://'+ref+'.supabase.co',supabase_publishable_key:'sb_publishable_fake_public',STUDENT_CREATORS_PROJECT_REF:ref};
 const calls=[];
 const fetcher=async (url,opts)=>{calls.push({url:String(url),headers:opts.headers});return Response.json([{id,active:true,code:'CSC101',title:'Introduction to computing'}]);};
 const result=await getPublicCourses({env,fetcher});
 assert.equal(result.state,'ready');
 assert.equal(result.courses[0].title,'Introduction to computing');
 assert.equal(calls[0].headers.apikey,'sb_publishable_fake_public');
 assert.equal(calls[0].url.startsWith(env.supabase_url+'/rest/v1/courses'),true);
 assert.equal('authorization' in calls[0].headers,false);
});
