import {supabaseServerHeaders} from './supabase-runtime-config.mjs';
/** Server-only Supabase REST adapter. Do not import into browser components. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUUID(value) { if(!UUID.test(value)) throw new Error('Invalid identifier');return value; }
export function createSupabaseDraftDependencies({url,publicKey,serverKey,fetcher=fetch}) {
  if(!url || !publicKey || !serverKey || typeof fetcher!=='function') throw new Error('Missing Supabase configuration');
  const base=new URL(url);
  if(base.protocol!=='https:' && !(base.protocol==='http:' && ['localhost','127.0.0.1'].includes(base.hostname))) throw new Error('Supabase must use HTTPS');
  const api=async(path,{method='GET',body,prefer,params}={})=>{
    const endpoint=new URL(`/rest/v1/${path}`,base);
    if(params) for(const [k,v] of Object.entries(params)) endpoint.searchParams.set(k,v);
    const response=await fetcher(endpoint,{method,headers:{...supabaseServerHeaders(serverKey),...(body?{'content-type':'application/json'}:{}),...(prefer?{prefer}: {})},body:body?JSON.stringify(body):undefined,redirect:'error'});
    if(!response.ok) throw new Error(`Database unavailable: ${response.status}`);
    return response.status===204?[]:response.json();
  };
  const one=async(path,params)=>{
    const rows=await api(path,{params:{select:'*',...params,limit:'1'}});
    return rows?.[0]??null;
  };
  return {
    auth:{async getUser(token){
      const response=await fetcher(new URL('/auth/v1/user',base),{headers:{apikey:publicKey,authorization:`Bearer ${token}`},redirect:'error'});
      if(response.status===401||response.status===403) return null;
      if(!response.ok) throw new Error('Auth unavailable');
      const user=await response.json();return UUID.test(user?.id)?{id:user.id}:null;
    }},
    store:{
      async getProfile(id){const r=await one('student_profiles',{user_id:`eq.${requireUUID(id)}`});return r?{institutionId:r.institution_id,verifiedAt:r.verified_at,suspended:r.suspended}:null;},
      async getCourse(id){const r=await one('courses',{id:`eq.${requireUUID(id)}`});return r?{id:r.id,institutionId:r.institution_id,active:r.active}:null;},
      async getTopic(id){const r=await one('course_topics',{id:`eq.${requireUUID(id)}`});return r?{id:r.id,courseId:r.course_id}:null;},
      async insertDraftOnce({draft,creationKey,creationHash}){
        const payload={creator_id:draft.creatorId,institution_id:draft.institutionId,course_id:draft.courseId,topic_id:draft.topicId,title:draft.title,description:draft.description,preview_text:draft.previewText,rights_attested_at:new Date().toISOString(),status:'draft',creation_key:creationKey,creation_hash:creationHash};
        const rows=await api('content_items',{method:'POST',params:{on_conflict:'creator_id,creation_key',select:'id,creator_id,course_id,topic_id,title,status,creation_hash'},prefer:'resolution=ignore-duplicates,return=representation',body:payload});
        let row=rows?.[0];const created=!!row;
        if(!row) row=await one('content_items',{creator_id:`eq.${draft.creatorId}`,creation_key:`eq.${creationKey}`});
        if(!row) throw new Error('Idempotent insert was not visible');
        if(row.creation_hash!==creationHash) return {conflict:true};
        return {created,item:{id:row.id,creatorId:row.creator_id,courseId:row.course_id,topicId:row.topic_id,title:row.title,status:row.status}};
      }
    }
  };
}
