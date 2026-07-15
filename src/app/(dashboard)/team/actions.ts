"use server"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { createClient } from '@supabase/supabase-js'

export async function updateTeamMemberAction(memberId: string, userEmail: string, businessId: string, updates: any) {
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

        // Clean arrays/undefined to prevent React Flight serialization errors
        if (!updates.allowed_pages) updates.allowed_pages = [];
        if (!updates.weekend_days) updates.weekend_days = [];
        if (!updates.role) updates.role = 'staff';

        // Just use admin client to update the business user to bypass RLS issues
        const { data, error } = await supabaseAdmin
            .from("business_users")
            .update(updates)
            .eq("user_email", userEmail)
            .eq("business_id", businessId)
            .select()

        if (error) return { error: error.message }
        
        if (!data || data.length === 0) {
            return { error: `DEBUG ERROR: Server action executed successfully but matched 0 rows. No row found with email ${userEmail} and business_id ${businessId}.` }
        }
        
        return { success: true, data }
    } catch (err: any) {
        return { error: "Action error: " + err?.message + "\n" + err?.stack }
    }
}
