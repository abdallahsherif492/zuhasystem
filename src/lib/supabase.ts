import { createBrowserClient } from '@supabase/ssr'

// FALLBACK: Hardcoded keys to unblock Vercel deployment issues
const FALLBACK_URL = "https://telkkknuygjejmqcvyev.supabase.co";
const FALLBACK_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== "undefined")
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : FALLBACK_URL;

const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== "undefined")
    ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : FALLBACK_KEY;

if (supabaseUrl.includes("placeholder")) {
    console.warn("Using Placeholder URL - Connection will fail");
}

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export async function fetchAll<T = any>(
    fetchFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
    let allData: T[] = [];
    let from = 0;
    const step = 1000;

    while (true) {
        const { data, error } = await fetchFn(from, from + step - 1);
        if (error) {
            console.error("Error fetching records in fetchAll:", error);
            throw error;
        }
        if (data && data.length > 0) {
            allData.push(...data);
            if (data.length < step) {
                break;
            }
            from += step;
        } else {
            break;
        }
    }
    return allData;
}


