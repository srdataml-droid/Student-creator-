import test from 'node:test';
import assert from 'node:assert/strict';
import {loadHostedFeed} from './hosted-feed.mjs';
const courses=[{id:'a',code:'A',title:'Course A'},{id:'b',code:'B',title:'Course B'}];
const getCourses=async()=>({state:'ready',courses});
const result=(items)=>Response.json({items});
test('public previews are sorted and private fields and mismatched courses are excluded',async()=>{
 const feed=await loadHostedFeed({getCourses,getCatalog:async request=>{const id=new URL(request.url).searchParams.get('courseId');return result([{id,title:id,courseId:id,publishedAt:id==='a'?'2026-01-01':'2026-02-01',lessonText:'secret',priceKobo:20000,hasVideo:true},{id:'wrong',title:'Wrong',courseId:'other'}]);}});
 assert.deepEqual(feed.posts.map(p=>p.id),['b','a']);assert.equal(feed.partial,false);assert.equal(JSON.stringify(feed).includes('secret'),false);assert.equal('priceKobo' in feed.posts[0],false);assert.equal('hasVideo' in feed.posts[0],false);
});
test('partial and total outages are distinct from a genuine empty catalog',async()=>{
 const partial=await loadHostedFeed({getCourses,getCatalog:async req=>new URL(req.url).searchParams.get('courseId')==='a'?result([]):new Response(null,{status:503})});assert.equal(partial.partial,true);
 await assert.rejects(loadHostedFeed({getCourses,getCatalog:async()=>new Response(null,{status:503})}),/CATALOG_UNAVAILABLE/);
 await assert.rejects(loadHostedFeed({getCourses:async()=>({state:'not_configured',courses:[]})}),/CATALOG_UNAVAILABLE/);
 assert.deepEqual(await loadHostedFeed({getCourses:async()=>({state:'ready',courses:[]})}),{courses:[],posts:[],partial:false});
});
test('discovery caps provider requests and concurrent work',async()=>{
 const directory=Array.from({length:60},(_,i)=>({id:String(i),code:'C',title:'Course'}));let count=0,active=0,max=0;
 const feed=await loadHostedFeed({getCourses:async()=>({state:'ready',courses:directory}),getCatalog:async()=>{count++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return result([]);}});
 assert.equal(count,12);assert.equal(max,4);assert.equal(feed.courses.length,50);
});
