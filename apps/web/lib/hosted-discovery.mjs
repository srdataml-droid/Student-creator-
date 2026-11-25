import {readDedicatedSupabaseRuntimeConfig} from '../../../packages/content-core/src/supabase-runtime-config.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields='id,creator_id,institution_id,course_id,title,description,preview_text,published_at,status';
const clean=(v,max)=>typeof v==='string'?v.slice(0,max):'';
function reader(env,fetcher){
 const config=readDedicatedSupabaseRuntimeConfig(env);
 if(!config)throw Error('CATALOG_NOT_CONFIGURED');
 return async(table,params)=>{
  const url=new URL('/rest/v1/'+table,config.url);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const response=await fetcher(url,{headers:{apikey:config.publishableKey},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('CATALOG_UNAVAILABLE');
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error('INVALID_CATALOG_RESPONSE');
  return rows;
 };
}
function preview(row,course,school){
 if(row.status!=='published'||!UUID.test(row.id||'')||!UUID.test(row.creator_id||'')||row.course_id!==course.id||row.institution_id!==course.institution_id||row.institution_id!==school.id)return null;
 return {id:row.id,creatorId:row.creator_id,courseId:row.course_id,institutionId:row.institution_id,title:clean(row.title,160),description:clean(row.description,1000),previewText:clean(row.preview_text,1000),publishedAt:clean(row.published_at,40),courseCode:clean(course.code,32),courseTitle:clean(course.title,160),institutionName:clean(school.name,160)};
}
export async function getHostedDiscovery({env=process.env,fetcher=fetch,lessonId=null,directoryOnly=false}={}){
 if(lessonId!==null&&!UUID.test(lessonId))return {posts:[],courses:[],schools:[]};
 const read=reader(env,fetcher);
 const params={select:fields,status:'eq.published',order:'published_at.desc.nullslast,id.asc',limit:lessonId?1:60,...(lessonId?{id:'eq.'+lessonId}:{})};
 const [rows,courseRows,schoolRows]=await Promise.all([
  directoryOnly?Promise.resolve([]):read('content_items',params),
  read('courses',{select:'id,institution_id,code,title,active',active:'eq.true',order:'code.asc',limit:100}),
  read('institutions',{select:'id,name,active',active:'eq.true',order:'name.asc',limit:100})
 ]);
 const schools=new Map(schoolRows.filter(x=>x.active===true&&UUID.test(x.id||'')).map(x=>[x.id,x]));
 const courses=new Map(courseRows.filter(x=>x.active===true&&UUID.test(x.id||'')&&schools.has(x.institution_id)).map(x=>[x.id,x]));
 const posts=rows.filter(x=>!lessonId||x.id===lessonId).map(x=>courses.has(x.course_id)&&schools.has(x.institution_id)?preview(x,courses.get(x.course_id),schools.get(x.institution_id)):null).filter(Boolean);
 return {posts,courses:[...courses.values()].map(x=>({id:x.id,institutionId:x.institution_id,code:clean(x.code,32),title:clean(x.title,160)})),schools:[...schools.values()].map(x=>({id:x.id,name:clean(x.name,160)}))};
}
export function filterHostedPreviews(posts,{q='',institutionId='',courseId=''}={}){
 const query=q.trim().toLowerCase();
 return posts.filter(p=>(!institutionId||p.institutionId===institutionId)&&(!courseId||p.courseId===courseId)&&[p.title,p.description,p.previewText,p.courseCode,p.courseTitle,p.institutionName].join(' ').toLowerCase().includes(query));
}
