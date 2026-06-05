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

interface BusinessContextType {
  activeBusiness: Business | null;
  userRole: string | null;
  isSystemAdmin: boolean;
  businesses: BusinessUser[];
  setActiveBusiness: (businessId: string) => void;
  loading: boolean;
}

const BusinessContext = createContext<BusinessContextType>({
  activeBusiness: null,
  userRole: null,
  isSystemAdmin: false,
  businesses: [],
  setActiveBusiness: () => {},
  loading: true,
});

export const useBusiness = () => useContext(BusinessContext);

export const BusinessProvider = ({ children }: { children: React.ReactNode }) => {
  const [activeBusiness, setActiveBusinessState] = useState<Business | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessUser[]>([]);
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
        const active = formatted.find(b => b.business.id === savedId) || formatted[0];
        
        setActiveBusinessState(active.business);
        setUserRole(active.role);
        localStorage.setItem('activeBusinessId', active.business.id);
      } else {
        // User has no businesses. Redirect to onboarding if not on onboarding page.
        if (pathname !== '/onboarding' && pathname !== '/' && !pathname.startsWith('/system-admin')) {
          router.push('/onboarding');
        }
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

  return (
    <BusinessContext.Provider value={{ activeBusiness, userRole, isSystemAdmin, businesses, setActiveBusiness, loading }}>
      {children}
    </BusinessContext.Provider>
  );
};
