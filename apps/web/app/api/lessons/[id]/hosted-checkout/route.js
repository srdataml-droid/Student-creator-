import {buildHostedPaystackRoute} from '../../../../../../../packages/hosted-core/src/hosted-paystack-bridge.mjs';
const handler=buildHostedPaystackRoute();
export const runtime='nodejs';
export async function POST(request,{params}){return handler(request,{lessonId:(await params).id});}
