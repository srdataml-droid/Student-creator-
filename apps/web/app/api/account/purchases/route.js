import {createFinanceReadHandler} from '../../../../lib/hosted-finance-read.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){return createFinanceReadHandler()(request);}
