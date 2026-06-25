-- Fix RLS policies for attendance_logs to be case-insensitive for emails
DROP POLICY IF EXISTS "Users can view their own attendance" ON public.attendance_logs;
CREATE POLICY "Users can view their own attendance"
    ON public.attendance_logs
    FOR SELECT
    USING (auth.email() = LOWER(user_email));

DROP POLICY IF EXISTS "Users can insert their own attendance" ON public.attendance_logs;
CREATE POLICY "Users can insert their own attendance"
    ON public.attendance_logs
    FOR INSERT
    WITH CHECK (auth.email() = LOWER(user_email));

DROP POLICY IF EXISTS "Users can update their own attendance" ON public.attendance_logs;
CREATE POLICY "Users can update their own attendance"
    ON public.attendance_logs
    FOR UPDATE
    USING (auth.email() = LOWER(user_email));

DROP POLICY IF EXISTS "Business admins can view all attendance in their business" ON public.attendance_logs;
CREATE POLICY "Business admins can view all attendance in their business"
    ON public.attendance_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.business_users
            WHERE business_users.business_id = attendance_logs.business_id
            AND LOWER(business_users.user_email) = auth.email()
            AND business_users.role IN ('owner', 'admin')
        )
    );
