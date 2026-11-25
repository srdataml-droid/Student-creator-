import {buildHostedClassTokenRoute} from '../../../../../../../packages/hosted-core/src/hosted-livekit-class.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request,context){return buildHostedClassTokenRoute()(request,await context.params);}
