CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    date DATE NOT NULL,
    clock_in_time TIMESTAMPTZ NOT NULL,
    clock_out_time TIMESTAMPTZ,
    status VARCHAR DEFAULT 'present',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(business_id, user_email, date)
);

-- Enable RLS
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own attendance"
    ON public.attendance_logs
    FOR SELECT
    USING (auth.email() = user_email);

CREATE POLICY "Users can insert their own attendance"
    ON public.attendance_logs
    FOR INSERT
    WITH CHECK (auth.email() = user_email);

CREATE POLICY "Users can update their own attendance"
    ON public.attendance_logs
    FOR UPDATE
    USING (auth.email() = user_email);

CREATE POLICY "Business admins can view all attendance in their business"
    ON public.attendance_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.business_users
            WHERE business_users.business_id = attendance_logs.business_id
            AND business_users.user_email = auth.email()
            AND business_users.role IN ('owner', 'admin')
        )
    );
