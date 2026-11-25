import {buildLivePaystackRoute} from '../../../../../../../packages/hosted-core/src/live-paystack-runtime.mjs';
export const runtime='nodejs';
const handler=buildLivePaystackRoute();
export async function POST(request,{params}){return handler(request,{lessonId:(await params).id});}
