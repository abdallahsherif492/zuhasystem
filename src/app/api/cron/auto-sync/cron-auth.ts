import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * Who is asking for a sync run.
 *
 * The endpoint reaches out to every tenant's courier accounts using their
 * stored credentials, so it must never be open. There are two legitimate
 * callers with deliberately different reach:
 *
 *  - the scheduler, holding CRON_SECRET, may sweep every business;
 *  - a signed-in user's browser (AutoSyncProvider) may only trigger the
 *    businesses that user actually belongs to.
 */
export type CronCaller =
    | { kind: "scheduler" }
    | { kind: "user"; email: string; businessIds: string[] }
    | { kind: "denied"; reason: string };

export async function resolveCronCaller(request: Request): Promise<CronCaller> {
    const secret = process.env.CRON_SECRET;
    const header = request.headers.get("authorization");

    if (header?.startsWith("Bearer ")) {
        // Fail closed: with no secret configured there is nothing to verify
        // against, so a bearer token can never be accepted.
        if (!secret) {
            return { kind: "denied", reason: "CRON_SECRET is not configured on the server." };
        }
        if (timingSafeEqual(header.slice(7), secret)) {
            return { kind: "scheduler" };
        }
        return { kind: "denied", reason: "Invalid cron secret." };
    }

    // No bearer token — fall back to the signed-in user's session cookie.
    try {
        const cookieStore = await cookies();
        const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll() {
                    /* read-only: this route never refreshes the session */
                },
            },
        });

        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) {
            return { kind: "denied", reason: "Not signed in." };
        }

        // Membership is read through the caller's own session, so RLS decides
        // what they may see — the service-role client is never used here.
        const { data: links } = await supabase
            .from("business_users")
            .select("business_id")
            .eq("user_email", user.email);

        const businessIds = (links || [])
            .map((l: { business_id: string | null }) => l.business_id)
            .filter((id): id is string => !!id);

        if (businessIds.length === 0) {
            return { kind: "denied", reason: "No business membership." };
        }

        return { kind: "user", email: user.email, businessIds };
    } catch (e: any) {
        return { kind: "denied", reason: `Session check failed: ${e?.message || "unknown"}` };
    }
}

/** Constant-time compare so a wrong secret cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}
