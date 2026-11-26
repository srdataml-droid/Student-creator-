import {createFinanceReadHandler} from '../../../../../lib/hosted-finance-read.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request,{params}){const {lessonId}=await params;return createFinanceReadHandler({lessonId})(request);}
