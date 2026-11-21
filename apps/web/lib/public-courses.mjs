const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class PublicCatalogError extends Error {constructor(message){super(message);this.name='PublicCatalogError';}}
/** Public PostgREST read only. Handles missing configuration without pretending courses exist. */
export async function getPublicCourses({env=process.env,fetcher=fetch}={}) {
  if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY) return {state:'not_configured',courses:[]};
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))throw new PublicCatalogError('Invalid project URL');
  const dest=new URL('/rest/v1/courses',base);
  dest.searchParams.set('select','id,institution_id,department_id,code,title,active');
  dest.searchParams.set('active','eq.true');dest.searchParams.set('order','code.asc');dest.searchParams.set('limit','50');
  const res=await fetcher(dest,{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY},cache:'no-store',redirect:'error'});
  if(!res.ok)throw new PublicCatalogError('Course provider unavailable');
  const rows=await res.json();if(!Array.isArray(rows))throw new PublicCatalogError('Invalid provider response');
  return {state:'ready',courses:rows.filter(r=>r.active===true&&UUID.test(r.id)).map(r=>({id:r.id,institutionId:r.institution_id,departmentId:r.department_id,code:String(r.code??'').slice(0,32),title:String(r.title??'').slice(0,160)}))};
}
export async function getPublicCourse({id,env=process.env,fetcher=fetch}={}) {
  if(!UUID.test(id||''))return null;
  if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return null;
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))throw new PublicCatalogError('Invalid project URL');
  // A direct id lookup is necessary: a valid course may be beyond the first
  // directory page (50 results). Never infer nonexistence from a listing page.
  const dest=new URL('/rest/v1/courses',base);
  dest.searchParams.set('select','id,institution_id,department_id,code,title,active');
  dest.searchParams.set('id',`eq.${id}`);dest.searchParams.set('active','eq.true');dest.searchParams.set('limit','1');
  const response=await fetcher(dest,{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY},cache:'no-store',redirect:'error'});
  if(!response.ok)throw new PublicCatalogError('Course provider unavailable');
  const rows=await response.json();
  if(!Array.isArray(rows))throw new PublicCatalogError('Invalid provider response');
  const row=rows[0];
  return row?.id===id&&row.active===true?{id:row.id,institutionId:row.institution_id,departmentId:row.department_id,code:String(row.code??'').slice(0,32),title:String(row.title??'').slice(0,160)}:null;
}
