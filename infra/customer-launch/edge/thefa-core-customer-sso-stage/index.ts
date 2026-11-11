// FA_STAGING ONLY. Deploy with verify_jwt=true (Supabase gateway).
// The function accepts a Supabase OAuth client-specific user JWT,
// independently consults Supabase Auth, and never handles service_role.
import {createStageCustomerAuthProbe} from './runtime.mjs';
const env={SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
 SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY')};
Deno.serve(createStageCustomerAuthProbe({env}));
