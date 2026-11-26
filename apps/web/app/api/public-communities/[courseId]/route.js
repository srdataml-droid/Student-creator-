import {getPublicCourse} from '../../../../lib/public-courses.mjs';
import {discoveryConfig} from '../../../../lib/hosted-discovery.mjs';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(_request,{params}){
 const {courseId}=await params;
 if(!UUID.test(courseId||''))return Response.json({error:'NOT_FOUND'},{status:404,headers});
 try{
  discoveryConfig(process.env);
  const course=await getPublicCourse({id:courseId,fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(5000)})});
  if(!course)return Response.json({error:'NOT_FOUND'},{status:404,headers});
  return Response.json({id:course.id,title:course.title,code:course.code},{headers});
 }catch{return Response.json({error:'COMMUNITY_UNAVAILABLE'},{status:503,headers});}
}
