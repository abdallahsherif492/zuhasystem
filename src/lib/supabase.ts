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

/**
 * Read a whole table past PostgREST's 1,000-row cap.
 *
 * Paging with LIMIT/OFFSET over a query whose sort is not a total order is
 * silently lossy: rows tied on the sort column can be returned on two
 * consecutive pages and other rows on neither, and the database is entitled to
 * order the tie differently for each request. Measured on the accounting
 * ledger — 3,263 rows sorted by transaction_date, with 90 sharing 2026-06-28 —
 * three rows came back twice and three never came back at all.
 *
 * No caller here was ordering at all, which is the same problem without even a
 * partial order to start from. So the id is appended as the final sort key for
 * every page. It is the primary key on every table this is used with, so it
 * breaks every tie, and appending it leaves any ordering the caller asked for
 * intact.
 */
export async function fetchAll<T = any>(
    fetchFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
    let allData: T[] = [];
    let from = 0;
    const step = 1000;

    while (true) {
        const query: any = fetchFn(from, from + step - 1);
        const { data, error } = await (typeof query?.order === "function"
            ? query.order("id", { ascending: true })
            : query);
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


