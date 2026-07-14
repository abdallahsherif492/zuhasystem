-- Create inventory_damages table
CREATE TABLE IF NOT EXISTS public.inventory_damages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cost_at_time NUMERIC NOT NULL CHECK (cost_at_time >= 0),
  total_loss NUMERIC GENERATED ALWAYS AS (quantity * cost_at_time) STORED,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.inventory_damages ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies for business isolation
CREATE POLICY "Users can view their business damages"
    ON public.inventory_damages
    FOR SELECT
    USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));

CREATE POLICY "Users can insert their business damages"
    ON public.inventory_damages
    FOR INSERT
    WITH CHECK (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));

CREATE POLICY "Users can update their business damages"
    ON public.inventory_damages
    FOR UPDATE
    USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));

CREATE POLICY "Users can delete their business damages"
    ON public.inventory_damages
    FOR DELETE
    USING (business_id IN (SELECT public.get_my_business_ids()) OR public.am_i_admin_of_business(business_id));

