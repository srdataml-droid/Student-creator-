import {buildMediaSourceRoute} from '../../../../../../../packages/hosted-core/src/live-media-source.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const handler=buildMediaSourceRoute();
export async function POST(request,{params}){return handler(request,{lessonId:(await params).id});}
export async function GET(request,{params}){return handler(request,{lessonId:(await params).id});}
