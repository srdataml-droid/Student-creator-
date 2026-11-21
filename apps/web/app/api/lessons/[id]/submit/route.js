import {buildReviewSubmissionRoute} from '../../../../../../../packages/content-core/src/route-factory.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,{params}){
  const {id}=await params;
  return buildReviewSubmissionRoute()(request,{lessonId:id});
}
