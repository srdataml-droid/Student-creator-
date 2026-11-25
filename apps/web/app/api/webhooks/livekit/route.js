import {buildHostedLearningWebhook} from '../../../../../../packages/hosted-core/src/hosted-livekit-class.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){return buildHostedLearningWebhook()(request);}
