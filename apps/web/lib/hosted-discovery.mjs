import {readSupabaseRuntimeConfig,readDedicatedSupabaseRuntimeConfig} from '../../../packages/content-core/src/supabase-runtime-config.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF='jnkqmlbkkvccnxrgkpno';
export function discoveryConfig(env){
 if(env.STUDENT_CREATORS_ENVIRONMENT==='production'){const cfg=readDedicatedSupabaseRuntimeConfig(env);if(!cfg)throw Error('CATALOG_UNAVAILABLE');return cfg;}
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_STAGING_APPROVED!=='true'||env.STUDENT_CREATORS_PROJECT_REF!==REF||env.STUDENT_CREATORS_PUBLIC_REGISTRATION!=='false'||env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED!=='false')throw Error('CATALOG_UNAVAILABLE');
 const config=readSupabaseRuntimeConfig(env);
 if(!config||config.url!=='https://'+REF+'.supabase.co')throw Error('CATALOG_UNAVAILABLE');
 const k=config.publishableKey;
 if(/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(k))return config;
 try{if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k)||k.length>4096)throw Error();const p=JSON.parse(Buffer.from(k.split('.')[1],'base64url').toString('utf8'));if(p.role==='anon'&&p.ref===REF)return config;}catch{}
 throw Error('CATALOG_UNAVAILABLE');
}
export function normalizeDiscoveryFilters({q='',courseId='',page='1'}={}){
 if(typeof q!=='string'||typeof courseId!=='string'||typeof page!=='string')throw Error('INVALID_DISCOVERY_FILTER');
 const query=q.trim().replace(/\s+/gu,' ');
 if(query&&(query.length<2||query.length>80||!/^[\p{L}\p{N}\p{M} '’\-]+$/u.test(query)))throw Error('INVALID_DISCOVERY_FILTER');
 if(courseId&&!UUID.test(courseId))throw Error('INVALID_DISCOVERY_FILTER');
 if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(page))throw Error('INVALID_DISCOVERY_FILTER');
 return {query,courseId,page:Number(page)};
}
function readPublicPrice(row){const listings=Array.isArray(row.listing)?row.listing.filter(x=>x?.content_id===row.id&&x.creator_id===row.creator_id&&x.currency==='NGN'&&x.state==='active'&&Number.isSafeInteger(x.price_kobo)&&x.price_kobo>=20000&&x.price_kobo<=1000000000):[];return listings.length===1?{priceKobo:listings[0].price_kobo}:{};}
export async function getHostedDiscovery({filters={},contentId='',contentIds=null,format='',includeCreators=false,env=process.env,fetcher=fetch}={}){
 const {query,courseId,page}=normalizeDiscoveryFilters(filters);
 if(format&&!['short','video'].includes(format))throw Error('INVALID_DISCOVERY_FILTER');
 if(contentId&&!UUID.test(contentId))throw Error('INVALID_DISCOVERY_FILTER');
 if(contentIds!==null&&(!Array.isArray(contentIds)||contentIds.length<1||contentIds.length>24||new Set(contentIds).size!==contentIds.length||contentIds.some(id=>typeof id!=='string'||!UUID.test(id))||contentId||query||courseId||page!==1||format))throw Error('INVALID_DISCOVERY_FILTER');
 const config=discoveryConfig(env);
 const url=new URL('/rest/v1/content_items',config.url);
 const size=24;
 const select='id,creator_id,course_id,institution_id,title,preview_text,published_at,status,content_format,listing:listings!listings_content_id_creator_id_fkey(content_id,creator_id,price_kobo,currency,state),course:courses!content_items_course_id_fkey!inner(id,code,title,active,institution_id),institution:institutions!content_items_institution_id_fkey!inner(id,name,active)';
 for(const [k,v] of Object.entries({select,status:'eq.published','course.active':'eq.true','institution.active':'eq.true',order:'published_at.desc,id.desc',limit:String(size+1),offset:String((page-1)*size)}))url.searchParams.set(k,v);
 if(format)url.searchParams.set('content_format','eq.'+format);
 if(contentId)url.searchParams.set('id','eq.'+contentId);
 if(contentIds)url.searchParams.set('id','in.('+contentIds.join(',')+')');
 if(courseId)url.searchParams.set('course_id','eq.'+courseId);
 if(query)url.searchParams.set('or','(title.ilike.*'+query+'*,preview_text.ilike.*'+query+'*)');
 const response=await fetcher(url,{headers:{apikey:config.publishableKey,accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('CATALOG_UNAVAILABLE');
 const rows=await response.json();
 if(!Array.isArray(rows)||rows.length>size+1)throw Error('CATALOG_UNAVAILABLE');
 const items=rows.slice(0,size).filter(r=>r&&r.status==='published'&&UUID.test(r.id)&&UUID.test(r.course_id)&&UUID.test(r.institution_id)&&r.course?.active===true&&r.course.id===r.course_id&&r.course.institution_id===r.institution_id&&r.institution?.active===true&&r.institution.id===r.institution_id&&(!format||r.content_format===format)&&(!contentId||r.id===contentId)&&(!contentIds||contentIds.includes(r.id))&&(!courseId||r.course_id===courseId)&&typeof r.title==='string'&&typeof r.published_at==='string'&&Number.isFinite(Date.parse(r.published_at))).map(r=>({id:r.id,...(['short','video'].includes(r.content_format)?{contentFormat:r.content_format}:{}),...readPublicPrice(r),...(UUID.test(r.creator_id??'')?{creatorId:r.creator_id}:{}),courseId:r.course_id,title:r.title.slice(0,160),previewText:typeof r.preview_text==='string'?r.preview_text.slice(0,800):'',publishedAt:r.published_at,courseCode:String(r.course.code??'').slice(0,32),courseTitle:String(r.course.title??'').slice(0,160),institutionName:String(r.institution.name??'').slice(0,160)}));
 // Public aliases only. No private identity records or signed media URLs are exposed.
 if(includeCreators){
  const ids=[...new Set(items.map(item=>item.creatorId).filter(id=>UUID.test(id??'')))];
  if(ids.length)try{
   const u=new URL('/rest/v1/creator_public_profiles',config.url);
   u.searchParams.set('select','user_id,display_name,handle');
   u.searchParams.set('user_id','in.('+ids.join(',')+')');
   u.searchParams.set('limit',String(ids.length));
   const response=await fetcher(u,{headers:{apikey:config.publishableKey,accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(2500)});
   if(response.ok){
    const profiles=await response.json();
    if(Array.isArray(profiles)&&profiles.length<=ids.length){
     const aliases=new Map(profiles.filter(p=>p&&ids.includes(p.user_id)&&typeof p.display_name==='string'&&typeof p.handle==='string').map(p=>[p.user_id,{displayName:p.display_name.slice(0,80),handle:p.handle.slice(0,64)}]));
     for(const item of items){const alias=aliases.get(item.creatorId);if(alias)Object.assign(item,alias);}
    }
   }
  }catch{}
 }
 return {items,page,hasNext:!contentIds&&rows.length>size&&page<50};
}
