import {buildLiveLearningCheckoutRoute} from '../../../../../../../packages/hosted-core/src/live-paystack-runtime.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,context){const {classId}=await context.params;return buildLiveLearningCheckoutRoute({kind:'class'})(request,{resourceId:classId});}
