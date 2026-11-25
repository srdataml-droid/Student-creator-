import {buildHostedClassTokenRoute} from '../../../../../../../packages/hosted-core/src/hosted-livekit-class.mjs';
const handler=buildHostedClassTokenRoute();
export const runtime='nodejs';
export async function POST(request,{params}){return handler(request,await params);}
