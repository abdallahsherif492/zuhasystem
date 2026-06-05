-- ==========================================
-- PHASE 7: HR & PERMISSIONS SYSTEM
-- ==========================================

-- 1. Extend business_users with shift and permission info
ALTER TABLE public.business_users
ADD COLUMN IF NOT EXISTS allowed_pages JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS shift_start TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS shift_end TIME DEFAULT '17:00:00',
ADD COLUMN IF NOT EXISTS weekend_days JSONB DEFAULT '["Friday", "Saturday"]'::jsonb;

-- 2. Create hr_requests table for leaves and permissions
CREATE TABLE IF NOT EXISTS public.hr_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    request_type TEXT NOT NULL CHECK (request_type IN ('leave', 'permission')),
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.hr_requests ENABLE ROW LEVEL SECURITY;

-- Staff can view their own requests, owners/admins can view all for their business
DROP POLICY IF EXISTS "Users can view their own requests" ON public.hr_requests;
CREATE POLICY "Users can view their own requests" 
ON public.hr_requests FOR SELECT 
TO authenticated
USING (
    user_email = auth.jwt() ->> 'email' 
    OR 
    EXISTS (
        SELECT 1 FROM public.business_users bu 
        WHERE bu.business_id = hr_requests.business_id 
        AND bu.user_email = auth.jwt() ->> 'email'
        AND bu.role IN ('Owner', 'Admin')
    )
);

-- Staff can insert their own requests
DROP POLICY IF EXISTS "Users can create requests" ON public.hr_requests;
CREATE POLICY "Users can create requests" 
ON public.hr_requests FOR INSERT 
TO authenticated
WITH CHECK (
    user_email = auth.jwt() ->> 'email' AND
    business_id IN (
        SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'
    )
);

-- Admins can update status of requests
DROP POLICY IF EXISTS "Admins can update requests" ON public.hr_requests;
CREATE POLICY "Admins can update requests" 
ON public.hr_requests FOR UPDATE 
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.business_users bu 
        WHERE bu.business_id = hr_requests.business_id 
        AND bu.user_email = auth.jwt() ->> 'email'
        AND bu.role IN ('Owner', 'Admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.business_users bu 
        WHERE bu.business_id = hr_requests.business_id 
        AND bu.user_email = auth.jwt() ->> 'email'
        AND bu.role IN ('Owner', 'Admin')
    )
);

-- Force schema reload
NOTIFY pgrst, 'reload schema';
