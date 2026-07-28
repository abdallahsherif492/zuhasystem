"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";
import { safeLocal } from "@/lib/safe-storage";

export interface Business {
  id: string;
  name: string;
  logo_url: string | null;
  theme_config: any;
  subscription_status: string;
  subscription_end_date: string | null;
}

export interface BusinessUser {
  role: string;
  allowed_pages: string[];
  shift_start: string | null;
  shift_end: string | null;
  weekend_days: string[];
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
  meta_pixel_enabled?: boolean;
  meta_pixel_id?: string;
}

interface BusinessContextType {
  activeBusiness: Business | null;
  userRole: string | null;
  currentUser: any | null;
  allowedPages: string[];
  shiftStart: string | null;
  shiftEnd: string | null;
  weekendDays: string[];
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
  currentUser: null,
  allowedPages: [],
  shiftStart: null,
  shiftEnd: null,
  weekendDays: [],
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
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [allowedPages, setAllowedPages] = useState<string[]>([]);
  const [shiftStart, setShiftStart] = useState<string | null>(null);
  const [shiftEnd, setShiftEnd] = useState<string | null>(null);
  const [weekendDays, setWeekendDays] = useState<string[]>([]);
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
        return;
      }
      setCurrentUser(user);

      // Check System Admin
      const { data: sysAdmin } = await supabase
        .from('business_users')
        .select('*')
        .eq('user_email', user.email)
        .ilike('role', '%super%')
        .maybeSingle();
        
      if (sysAdmin) {
        setIsSystemAdmin(true);
      }

      // Fetch User's Businesses
      const { data: userBusinesses, error } = await supabase
        .from('business_users')
        .select(`
          role,
          allowed_pages,
          shift_start,
          shift_end,
          weekend_days,
          business:businesses (
            id,
            name,
            logo_url,
            theme_config,
            subscription_status,
            subscription_end_date
          )
        `)
        .eq('user_email', user.email);

      if (userBusinesses && userBusinesses.length > 0) {
        // Formatted to match TS Interfaces
        const formatted = userBusinesses.map((b: any) => ({
          role: b.role,
          allowed_pages: b.allowed_pages || [],
          shift_start: b.shift_start,
          shift_end: b.shift_end,
          weekend_days: b.weekend_days || [],
          business: b.business as Business
        }));
        
        setBusinesses(formatted);

        // Retrieve saved active business from localStorage, or default to the first one
        const savedId = safeLocal.get('activeBusinessId');
        let active = formatted.find((b: any) => b.business.id === savedId);
        
        // --- GOD MODE (Impersonation) ---
        if (!active && sysAdmin && savedId) {
            const { data: impBusiness } = await supabase.from('businesses').select('*').eq('id', savedId).single();
            if (impBusiness) {
                const impObj = { 
                  role: 'Platform Admin', 
                  allowed_pages: [], 
                  shift_start: null, 
                  shift_end: null, 
                  weekend_days: [], 
                  business: impBusiness as Business 
                };
                formatted.push(impObj);
                active = impObj;
            }
        }
        
        active = active || formatted[0];
        
        setActiveBusinessState(active.business);
        setUserRole(active.role);
        setAllowedPages(active.allowed_pages);
        setShiftStart(active.shift_start);
        setShiftEnd(active.shift_end);
        setWeekendDays(active.weekend_days);
        safeLocal.set('activeBusinessId', active.business.id);
      } else {
        // User has no businesses. Redirect to onboarding if not on onboarding page.
        const skipped = safeLocal.get('skipOnboarding');
        if (pathname !== '/onboarding' && !pathname.startsWith('/system-admin') && !skipped) {
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
    };

    // `loading` gates every dashboard page behind a spinner, so it must resolve
    // no matter what happens above. Without this, a rejected request — or a
    // browser that throws on storage access, which is common in the Facebook
    // and Instagram in-app browsers and iOS Private Browsing — left the app
    // spinning forever after login.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setLoading(false);
    };

    // A mobile request can hang without ever rejecting. Give up waiting and
    // render: the guards below will still redirect if the user lacks access.
    const watchdog = setTimeout(settle, 12_000);

    fetchBusinessContext()
      .catch((e) => {
        console.error("[BusinessContext] Failed to load context:", e);
      })
      .finally(() => {
        clearTimeout(watchdog);
        settle();
      });

    return () => clearTimeout(watchdog);
  }, [pathname, router]);

  const setActiveBusiness = (businessId: string) => {
    const selected = businesses.find(b => b.business.id === businessId);
    if (selected) {
      setActiveBusinessState(selected.business);
      setUserRole(selected.role);
      setAllowedPages(selected.allowed_pages);
      setShiftStart(selected.shift_start);
      setShiftEnd(selected.shift_end);
      setWeekendDays(selected.weekend_days);
      safeLocal.set('activeBusinessId', selected.business.id);
      // Reload to ensure all data is fetched correctly for the new context
      window.location.reload();
    }
  };

  const impersonateBusiness = (businessId: string) => {
    if (!isSystemAdmin) return;
    safeLocal.set('activeBusinessId', businessId);
    window.location.href = '/dashboard';
  };

  return (
    <BusinessContext.Provider value={{ activeBusiness, userRole, currentUser, allowedPages, shiftStart, shiftEnd, weekendDays, isSystemAdmin, businesses, platformSettings, setActiveBusiness, impersonateBusiness, loading }}>
      {children}
    </BusinessContext.Provider>
  );
};
