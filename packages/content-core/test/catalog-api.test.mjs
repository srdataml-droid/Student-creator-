import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogHandler,createSupabaseCatalogStore} from '../src/catalog-api.mjs';
const course='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
const req=q=>new Request(`https://school.example/api/lessons?${q}`);
const row={id:'55555555-5555-4555-8555-555555555555',creatorId:'11111111-1111-4111-8111-111111111111',courseId:course,topicId:null,title:'Calculus',description:'Integration',previewText:'A sample',status:'published',publishedAt:'2026-11-19',privateObjectKey:'never expose',rightsAttestedAt:'never expose'};
const make=(rows=[row],courseRow={id:course,active:true})=>createCatalogHandler({store:{async getCourse(){return courseRow;},async listPublished(){return rows;}}});
test('public catalog returns only safe published course metadata',async()=>{
 const res=await make() (req(`courseId=${course}`));const data=await res.json();
 assert.equal(res.status,200);assert.equal(data.items.length,1);assert.equal(data.items[0].previewText,'A sample');assert.equal('privateObjectKey' in data.items[0],false);assert.equal('rightsAttestedAt' in data.items[0],false);
});
test('suppresses nonpublished and off-course items even if storage misbehaves',async()=>{
 const x=[{...row,status:'draft'},{...row,status:'in_review'},{...row,courseId:other},{...row,status:'published'}];
 const data=await (await make(x)(req(`courseId=${course}`))).json();assert.equal(data.items.length,1);
});
test('rejects invalid course, offset, topic and unbounded limits',async()=>{
 for(const q of ['','courseId=no','courseId='+course+'&limit=31','courseId='+course+'&offset=-1','courseId='+course+'&offset=1001','courseId='+course+'&topicId=x']){
  const res=await make()(req(q));assert.equal(res.status,400,q);
 }
});
test('inactive course returns not found',async()=>{
 const res=await make([],{id:course,active:false})(req(`courseId=${course}`));assert.equal(res.status,404);
});
test('database failure returns safe error without leaking stack',async()=>{
 const handle=createCatalogHandler({store:{async getCourse(){throw new Error('private server details');},async listPublished(){return []}}});
 const res=await handle(req(`courseId=${course}`));assert.equal(res.status,503);assert.equal(JSON.stringify(await res.json()).includes('private'),false);
});
test('public Supabase catalog never sends service-role headers',async()=>{
 const seen=[];const fetcher=async(url,opts)=>{seen.push({url:String(url),headers:opts.headers});return Response.json(seen.length===1?[{id:course,active:true}]:[{...row,creator_id:row.creatorId,course_id:course,topic_id:null,preview_text:row.previewText,published_at:row.publishedAt}])};
 const store=createSupabaseCatalogStore({url:'https://example.supabase.co',publicKey:'pub',fetcher});
 assert.equal((await store.getCourse(course)).active,true);assert.equal((await store.listPublished({courseId:course,topicId:null,limit:20,offset:0}))[0].courseId,course);
 assert.equal(seen[0].headers.apikey,'pub');assert.equal('authorization' in seen[0].headers,false);
 assert.match(seen[1].url,/status=eq.published/);assert.doesNotMatch(seen[1].url,/private_object_key/);
});
