import {buildSupabaseAuthEmailHook} from '../../../../../../packages/hosted-core/src/supabase-auth-email-hook.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=buildSupabaseAuthEmailHook();
