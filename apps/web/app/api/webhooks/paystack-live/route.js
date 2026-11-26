import {buildLivePaystackRoute} from '../../../../../../packages/hosted-core/src/live-paystack-runtime.mjs';
export const runtime='nodejs';
export const POST=buildLivePaystackRoute({webhook:true});
