import {readDedicatedSupabaseRuntimeConfig} from '../../../packages/content-core/src/supabase-runtime-config.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean=(v,max)=>typeof v==='string'?v.slice(0,max):'';
export function normalizeDiscoveryFilters({q='',courseId='',institutionId='',page='1'}={}){
 if(typeof q!=='string'||typeof courseId!=='string'||typeof institutionId!=='string'||typeof page!=='string')throw Error('INVALID_DISCOVERY_FILTER');
 const query=q.trim().replace(/\s+/gu,' ');
 if(query&&(query.length<2||query.length>80||!/^[\p{L}\p{N}\p{M} '’\-]+$/u.test(query)))throw Error('INVALID_DISCOVERY_FILTER');
 if((courseId&&!UUID.test(courseId))||(institutionId&&!UUID.test(institutionId)))throw Error('INVALID_DISCOVERY_FILTER');
 if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(page))throw Error('INVALID_DISCOVERY_FILTER');
 return {query,courseId,institutionId,page:Number(page)};
}
export async function getPagedHostedDiscovery({filters={},lessonId=null,env=process.env,fetcher=fetch}={}){
 const {query,courseId,institutionId,page}=normalizeDiscoveryFilters(filters);
 const config=readDedicatedSupabaseRuntimeConfig(env);if(!config)throw Error('CATALOG_NOT_CONFIGURED');
 const url=new URL('/rest/v1/content_items',config.url);
 if(lessonId!==null&&!UUID.test(lessonId))return {items:[],page:1,hasNext:false};
 const size=lessonId?1:24;
 const select='id,creator_id,course_id,institution_id,title,description,preview_text,published_at,status,course:courses!content_items_course_id_fkey!inner(id,code,title,active,institution_id),institution:institutions!content_items_institution_id_fkey!inner(id,name,active)';
 for(const [k,v] of Object.entries({select,status:'eq.published','course.active':'eq.true','institution.active':'eq.true',order:'published_at.desc,id.desc',limit:String(size+1),offset:String((page-1)*size)}))url.searchParams.set(k,v);
 if(lessonId)url.searchParams.set('id','eq.'+lessonId);
 if(institutionId)url.searchParams.set('institution_id','eq.'+institutionId);
 if(courseId)url.searchParams.set('course_id','eq.'+courseId);
 if(query)url.searchParams.set('or','(title.ilike.*'+query+'*,description.ilike.*'+query+'*,preview_text.ilike.*'+query+'*)');
 const response=await fetcher(url,{headers:{apikey:config.publishableKey,accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('CATALOG_UNAVAILABLE');
 const rows=await response.json();
 if(!Array.isArray(rows)||rows.length>size+1)throw Error('CATALOG_UNAVAILABLE');
 const items=rows.slice(0,size).filter(r=>r&&r.status==='published'&&UUID.test(r.id)&&UUID.test(r.course_id)&&UUID.test(r.institution_id)&&r.course?.active===true&&r.course.id===r.course_id&&r.course.institution_id===r.institution_id&&r.institution?.active===true&&r.institution.id===r.institution_id&&UUID.test(r.creator_id)&&(!lessonId||r.id===lessonId)&&(!institutionId||r.institution_id===institutionId)&&(!courseId||r.course_id===courseId)&&typeof r.title==='string'&&typeof r.published_at==='string'&&Number.isFinite(Date.parse(r.published_at))).map(r=>({id:r.id,creatorId:r.creator_id,institutionId:r.institution_id,courseId:r.course_id,description:clean(r.description,2500),title:r.title.slice(0,160),previewText:typeof r.preview_text==='string'?r.preview_text.slice(0,800):'',publishedAt:r.published_at,courseCode:String(r.course.code??'').slice(0,32),courseTitle:String(r.course.title??'').slice(0,160),institutionName:String(r.institution.name??'').slice(0,160)}));
 return {items,page,hasNext:!lessonId&&rows.length>size&&page<50};
}
