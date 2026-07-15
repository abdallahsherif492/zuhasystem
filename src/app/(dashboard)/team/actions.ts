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

        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlbGtra251eWdqZWptcWN2eWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MTU5NDAsImV4cCI6MjA4MjA5MTk0MH0.7q4Vyfz0CxAHCy49bKU6iy9xay0IxsqtMe4UATcg_cU"

        // Verify the caller is authorized
        const cookieStore = await cookies()
        const supabase = createServerClient(
            supabaseUrl,
            anonKey,
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

        // 1. Fetch the exact row first
        const { data: existingUser, error: fetchError } = await supabaseAdmin
            .from("business_users")
            .select("*")
            .eq("user_email", userEmail)
            .eq("business_id", businessId)
            .single();

        if (fetchError || !existingUser) {
             return { error: `DEBUG ERROR: Could not fetch user before update. Email: ${userEmail}. Error: ${fetchError?.message}` };
        }

        // 2. Perform the update
        const { data, error } = await supabaseAdmin
            .from("business_users")
            .update({
                role: updates.role,
                allowed_pages: updates.allowed_pages, // Storing as JSONB
                shift_start: updates.shift_start,
                shift_end: updates.shift_end,
                weekend_days: updates.weekend_days
            })
            .eq("id", existingUser.id) // using the precise ID from the fetched row
            .select();

        if (error) return { error: `DEBUG ERROR: Update failed. ${error.message}` }
        
        if (!data || data.length === 0) {
            return { error: `DEBUG ERROR: Update executed but matched 0 rows using ID ${existingUser.id}` }
        }
        
        return { 
            success: true, 
            data, 
            debug: `Found ${userEmail}. Old allowed_pages: ${JSON.stringify(existingUser.allowed_pages)}. New: ${JSON.stringify(data[0].allowed_pages)}` 
        }
    } catch (err: any) {
        return { error: "Action error: " + err?.message + "\n" + err?.stack }
    }
}
