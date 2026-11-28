import {buildDraftRoute} from '../../../../../../packages/content-core/src/route-factory.mjs';
import {createCurrentSupabaseAuth} from '../../../../../../packages/hosted-core/src/supabase-current-auth.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=buildDraftRoute({authFactory:createCurrentSupabaseAuth});
