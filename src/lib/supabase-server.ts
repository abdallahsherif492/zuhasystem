import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// FALLBACK: Hardcoded keys to unblock Vercel deployment issues
const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";

export async function createSupabaseServerClient() {
    const cookieStore = await cookies();

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "undefined")
        ? process.env.NEXT_PUBLIC_SUPABASE_URL
        : FALLBACK_URL;

    // We only use SERVICE_ROLE_KEY if it's not the Vercel masked string "[SENSITIVE]"
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY !== "undefined" && process.env.SUPABASE_SERVICE_ROLE_KEY !== "[SENSITIVE]")
        ? process.env.SUPABASE_SERVICE_ROLE_KEY
        : ((process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== "undefined") ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : FALLBACK_KEY);

    return createServerClient(
        supabaseUrl,
        supabaseKey,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
            },
        }
    );
}
