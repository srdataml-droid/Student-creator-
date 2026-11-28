import {buildReviewSubmissionRoute} from '../../../../../../../packages/content-core/src/route-factory.mjs';
import {createCurrentSupabaseAuth} from '../../../../../../../packages/hosted-core/src/supabase-current-auth.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,{params}){
  const {id}=await params;
  return buildReviewSubmissionRoute({authFactory:createCurrentSupabaseAuth})(request,{lessonId:id});
}
