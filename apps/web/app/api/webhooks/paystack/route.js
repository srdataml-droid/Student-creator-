import {buildHostedPaystackRoute} from '../../../../../../packages/hosted-core/src/hosted-paystack-bridge.mjs';
export const runtime='nodejs';
export const POST=buildHostedPaystackRoute({webhook:true});
