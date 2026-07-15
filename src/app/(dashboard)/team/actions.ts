"use server"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { createClient } from '@supabase/supabase-js'

export async function updateTeamMemberAction(memberId: string, updates: any) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://telkkknuygjejmqcvyev.supabase.co"
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        
        if (!serviceRoleKey) {
            return { error: "Missing service role key" }
        }

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
                        try {
                            cookiesToSet.forEach(({ name, value, options }) => {
                                cookieStore.set({ name, value, ...options })
                            })
                        } catch (error) {
                            // Ignored
                        }
                    },
                },
            }
        )

        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) return { error: "Not authenticated: " + (userError?.message || "") }

        // Just use admin client to update the business user to bypass RLS issues
        const { data, error } = await supabaseAdmin
            .from("business_users")
            .update(updates)
            .eq("id", memberId)
            .select()

        if (error) return { error: error.message }
        
        // TEMPORARY: Return error to force UI to show the updated row so we can debug
        if (data && data.length > 0) {
             const updatedPages = data[0].allowed_pages;
             return { error: `DEBUG: Row updated. allowed_pages=${JSON.stringify(updatedPages)}` }
        } else {
             return { error: `DEBUG: Update returned 0 rows! memberId=${memberId}` }
        }
        
        // return { success: true, data }
    } catch (err: any) {
        return { error: "Action error: " + err?.message + "\n" + err?.stack }
    }
}
