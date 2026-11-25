import {buildHostedHealthRoute} from '../../../../../../packages/hosted-core/src/hosted-health.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=buildHostedHealthRoute();
