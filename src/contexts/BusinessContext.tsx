"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";

export interface Business {
  id: string;
  name: string;
  logo_url: string | null;
  theme_config: any;
  subscription_status: string;
}

export interface BusinessUser {
  role: string;
  business: Business;
}

export interface PlatformSettings {
  maintenance_mode: boolean;
  maintenance_message: string;
  announcement_active: boolean;
  announcement_message: string;
  announcement_type: string;
  default_trial_days?: number;
  instapay_number?: string;
  instapay_name?: string;
}

interface BusinessContextType {
  activeBusiness: Business | null;
  userRole: string | null;
  isSystemAdmin: boolean;
  businesses: BusinessUser[];
  platformSettings: PlatformSettings | null;
  setActiveBusiness: (businessId: string) => void;
  impersonateBusiness: (businessId: string) => void;
  loading: boolean;
}

const BusinessContext = createContext<BusinessContextType>({
  activeBusiness: null,
  userRole: null,
  isSystemAdmin: false,
  businesses: [],
  platformSettings: null,
  setActiveBusiness: () => {},
  impersonateBusiness: () => {},
  loading: true,
});

export const useBusiness = () => useContext(BusinessContext);

export const BusinessProvider = ({ children }: { children: React.ReactNode }) => {
  const [activeBusiness, setActiveBusinessState] = useState<Business | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessUser[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const fetchBusinessContext = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoading(false);
        return;
      }

      // Check System Admin
      const { data: sysAdmin } = await supabase
        .from('system_admins')
        .select('*')
        .eq('user_email', user.email)
        .single();
        
      if (sysAdmin) {
        setIsSystemAdmin(true);
      }

      // Fetch User's Businesses
      const { data: userBusinesses, error } = await supabase
        .from('business_users')
        .select(`
          role,
          business:businesses (
            id,
            name,
            logo_url,
            theme_config,
            subscription_status
          )
        `)
        .eq('user_email', user.email);

      if (userBusinesses && userBusinesses.length > 0) {
        // Formatted to match TS Interfaces
        const formatted = userBusinesses.map((b: any) => ({
          role: b.role,
          business: b.business as Business
        }));
        
        setBusinesses(formatted);

        // Retrieve saved active business from localStorage, or default to the first one
        const savedId = localStorage.getItem('activeBusinessId');
        let active = formatted.find((b: any) => b.business.id === savedId);
        
        // --- GOD MODE (Impersonation) ---
        if (!active && sysAdmin && savedId) {
            const { data: impBusiness } = await supabase.from('businesses').select('*').eq('id', savedId).single();
            if (impBusiness) {
                const impObj = { role: 'Platform Admin', business: impBusiness as Business };
                formatted.push(impObj);
                active = impObj;
            }
        }
        
        active = active || formatted[0];
        
        setActiveBusinessState(active.business);
        setUserRole(active.role);
        localStorage.setItem('activeBusinessId', active.business.id);
      } else {
        // User has no businesses. Redirect to onboarding if not on onboarding page.
        if (pathname !== '/onboarding' && !pathname.startsWith('/system-admin')) {
          router.push('/onboarding');
        }
      }
      
      // Fetch Platform Settings
      const { data: settingsData } = await supabase
        .from('platform_settings')
        .select('*')
        .eq('id', 'global')
        .single();
        
      if (settingsData) {
        setPlatformSettings(settingsData as PlatformSettings);
      }

      setLoading(false);
    };

    fetchBusinessContext();
  }, [pathname, router]);

  const setActiveBusiness = (businessId: string) => {
    const selected = businesses.find(b => b.business.id === businessId);
    if (selected) {
      setActiveBusinessState(selected.business);
      setUserRole(selected.role);
      localStorage.setItem('activeBusinessId', selected.business.id);
      // Reload to ensure all data is fetched correctly for the new context
      window.location.reload();
    }
  };

  const impersonateBusiness = (businessId: string) => {
    if (!isSystemAdmin) return;
    localStorage.setItem('activeBusinessId', businessId);
    window.location.href = '/dashboard';
  };

  return (
    <BusinessContext.Provider value={{ activeBusiness, userRole, isSystemAdmin, businesses, platformSettings, setActiveBusiness, impersonateBusiness, loading }}>
      {children}
    </BusinessContext.Provider>
  );
};
