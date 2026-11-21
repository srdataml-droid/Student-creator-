/** Public metadata-only course feed. Never returns storage paths or lesson bodies. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPOSE=['id','creatorId','courseId','topicId','title','description','previewText','publishedAt'];
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export function createCatalogHandler({store}) {
  if(typeof store?.getCourse!=='function'||typeof store?.listPublished!=='function') throw new TypeError('Catalog storage unavailable');
  return async function GET(request){
    if(request.method!=='GET') return json(405,{error:'METHOD_NOT_ALLOWED'});
    try{
      const url=new URL(request.url);
      const courseId=url.searchParams.get('courseId');
      const topicId=url.searchParams.get('topicId');
      const limitStr=url.searchParams.get('limit')??'20';
      const offsetStr=url.searchParams.get('offset')??'0';
      if(!UUID.test(courseId||'')||(topicId!==null&&!UUID.test(topicId))||!/^(?:[1-9]|[12][0-9]|30)$/.test(limitStr)||!/^(?:0|[1-9][0-9]{0,3})$/.test(offsetStr)||Number(offsetStr)>1000) return json(400,{error:'INVALID_FILTER'});
      const course=await store.getCourse(courseId);
      if(!course||course.active!==true) return json(404,{error:'COURSE_NOT_FOUND'});
      const rows=await store.listPublished({courseId,topicId,limit:Number(limitStr),offset:Number(offsetStr)});
      if(!Array.isArray(rows))throw new Error('Bad store result');
      const items=rows.filter(row=>row.status==='published'&&row.courseId===courseId&&(!topicId||row.topicId===topicId)).slice(0,Number(limitStr)).map(row=>Object.fromEntries(EXPOSE.map(k=>[k,row[k]??null])));
      return json(200,{items,nextOffset:rows.length===Number(limitStr)?Number(offsetStr)+rows.length:null});
    }catch{return json(503,{error:'SERVICE_UNAVAILABLE'});}
  };
}
/** Uses the public publishable key and relies on Postgres RLS for final filtering. */
export function createSupabaseCatalogStore({url,publicKey,fetcher=fetch}) {
  if(!url||!publicKey||typeof fetcher!=='function')throw new TypeError('Catalog config missing');
  const base=new URL(url);
  if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new Error('HTTPS required');
  const get=async(table,params)=>{
    const dest=new URL(`/rest/v1/${table}`,base);
    for(const [k,v]of Object.entries(params)) dest.searchParams.set(k,String(v));
    const response=await fetcher(dest,{headers:{apikey:publicKey},redirect:'error'});
    if(!response.ok)throw new Error('Catalog provider error');
    return response.json();
  };
  return {
    async getCourse(id){const rows=await get('courses',{select:'id,active',id:`eq.${id}`,limit:1});return rows[0]?{id:rows[0].id,active:rows[0].active}:null;},
    async listPublished({courseId,topicId,limit,offset}){
      const params={select:'id,creator_id,course_id,topic_id,title,description,preview_text,published_at,status',course_id:`eq.${courseId}`,status:'eq.published',order:'published_at.desc',limit,offset};
      if(topicId)params.topic_id=`eq.${topicId}`;
      const rows=await get('content_items',params);
      return rows.map(row=>({id:row.id,creatorId:row.creator_id,courseId:row.course_id,topicId:row.topic_id,title:row.title,description:row.description,previewText:row.preview_text,publishedAt:row.published_at,status:row.status}));
    }
  };
}
