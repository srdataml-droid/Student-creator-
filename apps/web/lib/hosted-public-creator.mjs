import {discoveryConfig} from './hosted-discovery.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function getHostedPublicCreator({creatorId,env=process.env,fetcher=fetch}={}){
 if(!UUID.test(creatorId??''))return null;
 const cfg=discoveryConfig(env);
 async function read(table,params){const u=new URL('/rest/v1/'+table,cfg.url);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);const r=await fetcher(u,{headers:{apikey:cfg.publishableKey,accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('PROFILE_UNAVAILABLE');const rows=await r.json();if(!Array.isArray(rows))throw Error('PROFILE_UNAVAILABLE');return rows;}
 const profiles=await read('creator_public_profiles',{select:'user_id,handle,display_name,bio',user_id:'eq.'+creatorId,limit:1});
 if(!profiles.length)return null;
 const p=profiles[0];if(profiles.length!==1||p.user_id!==creatorId||typeof p.handle!=='string'||typeof p.display_name!=='string'||typeof p.bio!=='string')throw Error('PROFILE_UNAVAILABLE');
 const rows=await read('content_items',{select:'id,creator_id,title,preview_text,status,published_at,course:courses!content_items_course_id_fkey!inner(code,active),institution:institutions!content_items_institution_id_fkey!inner(active)',creator_id:'eq.'+creatorId,status:'eq.published','course.active':'eq.true','institution.active':'eq.true',order:'published_at.desc,id.desc',limit:60});
 return {creator:{id:creatorId,handle:p.handle,displayName:p.display_name,bio:p.bio},posts:rows.filter(x=>x.creator_id===creatorId&&UUID.test(x.id??'')&&x.status==='published'&&x.course?.active===true&&x.institution?.active===true).map(x=>({id:x.id,title:String(x.title??'').slice(0,160),previewText:String(x.preview_text??'').slice(0,800),courseCode:String(x.course?.code??'').slice(0,32)}))};
}
