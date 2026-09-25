import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase configuration. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the project-root .env file, then restart Vite.",
  );
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error(
    "Invalid VITE_SUPABASE_URL. It must look like https://your-project-ref.supabase.co.",
  );
}

if (
  !supabaseAnonKey.startsWith("sb_publishable_") &&
  !supabaseAnonKey.startsWith("eyJ")
) {
  throw new Error(
    "Invalid browser API key. Use a Supabase publishable key (sb_publishable_...) or legacy anon key (eyJ...). Never use a secret/service-role key.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});