import {buildMuxVideoRoute} from '../../../../../../../packages/hosted-core/src/mux-video-api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handler=buildMuxVideoRoute();
export async function POST(request,{params}){return handler(request,{lessonId:(await params).id});}
export async function GET(request,{params}){return handler(request,{lessonId:(await params).id});}
