CREATE TABLE IF NOT EXISTS public.integration_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    integration_name VARCHAR(50) NOT NULL, -- e.g., 'Telegraph', 'VROBO', 'EasyOrders', 'Auto-Sync'
    status VARCHAR(20) NOT NULL, -- 'success', 'error', 'info'
    message TEXT NOT NULL,
    details JSONB, -- For storing order numbers, error stacks, or additional context
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster querying by business and date
CREATE INDEX IF NOT EXISTS idx_integration_logs_business_date ON public.integration_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_integration ON public.integration_logs(integration_name);

-- RLS Policies
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for business users" ON public.integration_logs
    FOR SELECT
    USING (
        business_id IN (
            SELECT business_id FROM business_users WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Enable insert for authenticated users" ON public.integration_logs
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);
