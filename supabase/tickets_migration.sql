-- ==========================================
-- SUPPORT TICKETS MIGRATION
-- ==========================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'open', -- open, in_progress, resolved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ticket_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_email TEXT NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS POLICIES
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_replies ENABLE ROW LEVEL SECURITY;

-- 1. Support Tickets Policies
-- Admins can do everything
CREATE POLICY "Admins can manage all tickets" ON public.support_tickets FOR ALL TO authenticated 
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));

-- Users can insert for their business
CREATE POLICY "Users can create tickets" ON public.support_tickets FOR INSERT TO authenticated 
WITH CHECK (business_id IN (SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'));

-- Users can read their own business tickets
CREATE POLICY "Users can read own tickets" ON public.support_tickets FOR SELECT TO authenticated 
USING (business_id IN (SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email'));

-- 2. Ticket Replies Policies
-- Admins can do everything
CREATE POLICY "Admins can manage all ticket replies" ON public.ticket_replies FOR ALL TO authenticated 
USING (EXISTS (SELECT 1 FROM public.system_admins WHERE user_email = auth.jwt() ->> 'email'));

-- Users can insert replies to their business tickets
CREATE POLICY "Users can reply to own tickets" ON public.ticket_replies FOR INSERT TO authenticated 
WITH CHECK (ticket_id IN (
    SELECT id FROM public.support_tickets 
    WHERE business_id IN (SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email')
));

-- Users can read replies to their business tickets
CREATE POLICY "Users can read own ticket replies" ON public.ticket_replies FOR SELECT TO authenticated 
USING (ticket_id IN (
    SELECT id FROM public.support_tickets 
    WHERE business_id IN (SELECT business_id FROM public.business_users WHERE user_email = auth.jwt() ->> 'email')
));
