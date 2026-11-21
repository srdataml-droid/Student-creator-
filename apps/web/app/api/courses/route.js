import {getPublicCourses} from '../../../lib/public-courses.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 try{const result=await getPublicCourses();return Response.json(result,{headers:{'cache-control':'no-store'}});}
 catch{return Response.json({error:'COURSE_PROVIDER_UNAVAILABLE'},{status:503,headers:{'cache-control':'no-store'}});}
}
