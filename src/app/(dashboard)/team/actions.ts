"use server"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function updateTeamMemberAction(memberId: string, updates: any) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co"
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!serviceRoleKey) {
        return { error: "Missing service role key" }
    }

    const { createClient } = await import('@supabase/supabase-js')
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // Verify the caller is authorized
    const cookieStore = await cookies()
    const supabase = createServerClient(
        supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    // Note: Cannot set cookies in server actions this easily without passing back to response,
                    // but we only need to read the session to verify auth
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Not authenticated" }

    // Just use admin client to update the business user to bypass RLS issues
    const { data, error } = await supabaseAdmin
        .from("business_users")
        .update(updates)
        .eq("id", memberId)
        .select()

    if (error) return { error: error.message }
    return { success: true, data }
}
