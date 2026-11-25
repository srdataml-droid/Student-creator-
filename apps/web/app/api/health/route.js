import {releaseHealthResponse} from '../../../lib/release-health.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(){return releaseHealthResponse();}
