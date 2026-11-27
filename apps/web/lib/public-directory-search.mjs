import {discoveryConfig,normalizeDiscoveryFilters} from './hosted-discovery.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function searchCategory(value){return ['all','video','short','creators','communities'].includes(value)?value:'all';}
export async function searchPublicDirectory({category,q='',env=process.env,fetcher=fetch}={}){
 if(!['creators','communities'].includes(category))throw Error('INVALID_DISCOVERY_FILTER');
 const {query}=normalizeDiscoveryFilters({q});
 if(!query)return [];
 const cfg=discoveryConfig(env),creators=category==='creators';
 const url=new URL('/rest/v1/'+(creators?'creator_public_profiles':'courses'),cfg.url);
 const fields=creators?'user_id,display_name,handle':'id,code,title,active';
 url.searchParams.set('select',fields);
 url.searchParams.set('or',creators?'(display_name.ilike.*'+query+'*,handle.ilike.*'+query+'*)':'(code.ilike.*'+query+'*,title.ilike.*'+query+'*)');
 if(!creators)url.searchParams.set('active','eq.true');
 url.searchParams.set('order',creators?'display_name.asc,user_id.asc':'title.asc,id.asc');
 url.searchParams.set('limit','50');
 const res=await fetcher(url,{headers:{apikey:cfg.publishableKey,accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw Error('DIRECTORY_UNAVAILABLE');
 const rows=await res.json();
 if(!Array.isArray(rows)||rows.length>50)throw Error('DIRECTORY_UNAVAILABLE');
 return creators?rows.filter(r=>r&&UUID.test(r.user_id)&&typeof r.display_name==='string'&&typeof r.handle==='string').map(r=>({id:r.user_id,title:r.display_name.slice(0,80),subtitle:'@'+r.handle.slice(0,64)})):rows.filter(r=>r&&r.active===true&&UUID.test(r.id)&&typeof r.title==='string'&&typeof r.code==='string').map(r=>({id:r.id,title:r.title.slice(0,160),subtitle:r.code.slice(0,32)}));
}
