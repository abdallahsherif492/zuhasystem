"use client";

import React, { createContext, useContext, useCallback, useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useBusiness } from "@/contexts/BusinessContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/lib/supabase";
import { getPageSteps, getFullTourPages, WalkthroughStep } from "./walkthrough-steps";
import { walkthroughCss } from "./walkthrough-styles";

interface WalkthroughContextType {
  startPageTour: (pageId: string) => void;
  startFullTour: () => void;
  isTouring: boolean;
}

const WalkthroughContext = createContext<WalkthroughContextType>({
  startPageTour: () => {},
  startFullTour: () => {},
  isTouring: false,
});

export const useWalkthrough = () => useContext(WalkthroughContext);

// Map route to pageId
function getPageIdFromPath(pathname: string): string | null {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/accounting") return "accounting";
  if (pathname === "/products") return "products";
  if (pathname.startsWith("/orders")) return "orders";
  if (pathname === "/shipping") return "shipping";
  if (pathname === "/settings") return "settings";
  if (pathname === "/logistics") return "logistics";
  if (pathname === "/platform-orders") return "platform-orders";
  if (pathname === "/team") return "team";
  if (pathname === "/my-hr") return "my-hr";
  if (pathname === "/inventory/damages") return "damages";
  if (pathname === "/insights/actual-returns") return "actual-returns";
  if (pathname === "/actions-log") return "actions-log";
  return null;
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const { activeBusiness, userRole, allowedPages, isSystemAdmin } = useBusiness();
  const { direction } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const [isTouring, setIsTouring] = useState(false);
  const [hasCheckedFirstVisit, setHasCheckedFirstVisit] = useState(false);
  const driverRef = useRef<any>(null);

  /**
   * Convert our steps to driver.js format.
   *
   * A step whose element is not on the page is downgraded to a centered
   * popover instead of being silently mispositioned — the copy is still
   * useful even when the thing it points at is not rendered (empty tables,
   * permission-hidden buttons, elements that appear only after selection).
   */
  const toDriverSteps = (steps: WalkthroughStep[]): DriveStep[] => {
    return steps.map((step) => {
      const exists = step.element ? !!document.querySelector(step.element) : false;

      if (step.element && !exists && process.env.NODE_ENV === "development") {
        console.warn(`[Walkthrough] "${step.element}" not found — showing this step centered.`);
      }

      return {
        element: exists ? step.element : undefined,
        popover: {
          title: step.popover.title,
          description: step.popover.description,
          side: step.popover.side || "bottom",
          align: step.popover.align || "center",
        },
      };
    });
  };

  // Arrows have to follow the layout direction, or "next" points backwards.
  const isRtl = direction === "rtl";
  const nextArrow = isRtl ? "←" : "→";
  const prevArrow = isRtl ? "→" : "←";

  /**
   * Pages the current user can actually open. Without this the tour would
   * march a limited-permission employee through screens their sidebar hides.
   */
  const canAccessRoute = useCallback(
    (route: string) => {
      if (isSystemAdmin) return true;
      const role = userRole?.toLowerCase().trim() || "";
      if (role === "owner" || role === "admin" || role.includes("super")) return true;
      if (route === "/dashboard") return true;
      if (!allowedPages || allowedPages.length === 0) return false;
      return allowedPages.some((allowed) => route.startsWith(allowed));
    },
    [isSystemAdmin, userRole, allowedPages]
  );

  // Start tour for a specific page
  const startPageTour = useCallback((pageId: string) => {
    const steps = getPageSteps(pageId);
    if (steps.length === 0) return;

    // Small delay to let DOM render
    setTimeout(() => {
      const driverObj = driver({
        showProgress: true,
        showButtons: ["next", "previous", "close"],
        nextBtnText: `التالي ${nextArrow}`,
        prevBtnText: `${prevArrow} السابق`,
        doneBtnText: "تم ✓",
        progressText: "{{current}} من {{total}}",
        popoverClass: "ecommerx-walkthrough",
        steps: toDriverSteps(steps),
        onDestroyed: () => {
          setIsTouring(false);
        },
      });

      driverRef.current = driverObj;
      setIsTouring(true);
      driverObj.drive();
    }, 500);
  }, [nextArrow, prevArrow]);

  // Start the full sequential tour across all pages
  const startFullTour = useCallback(() => {
    const pages = getFullTourPages().filter((page) => canAccessRoute(page.route));
    if (pages.length === 0) return;

    // Immediately mark as completed so it doesn't run on reload
    markTourCompleted();

    let currentPageIndex = 0;
    let isCanceled = false;

    const runPageTour = (pageIndex: number) => {
      if (pageIndex >= pages.length) {
        // Tour complete
        setIsTouring(false);
        return;
      }

      const page = pages[pageIndex];

      // Navigate to the page
      router.push(page.route);

      // Wait for navigation and DOM to settle
      setTimeout(() => {
        const steps = toDriverSteps(page.steps);

        // Add a "next page" step at the end if not the last page
        if (pageIndex < pages.length - 1) {
          const nextPage = pages[pageIndex + 1];
          steps.push({
            popover: {
              title: `⏭️ الصفحة التالية: ${nextPage.title}`,
              description: "دوس 'التالي' عشان نكمل الشرح في الصفحة الجاية.",
              side: "bottom" as const,
              align: "center" as const,
            },
          });
        }

        const driverObj = driver({
          showProgress: true,
          showButtons: ["next", "previous", "close"],
          nextBtnText: `التالي ${nextArrow}`,
          prevBtnText: `${prevArrow} السابق`,
          doneBtnText: pageIndex < pages.length - 1 ? `الصفحة التالية ${nextArrow}` : "🎉 تم!",
          progressText: `${page.title} — {{current}} من {{total}}`,
          popoverClass: "ecommerx-walkthrough",
          steps,
          onCloseClick: () => {
            isCanceled = true;
            driverObj.destroy();
          },
          onDestroyed: () => {
            if (isCanceled) {
              setIsTouring(false);
              return;
            }
            
            // Check if we should move to next page
            currentPageIndex = pageIndex + 1;
            if (currentPageIndex < pages.length) {
              runPageTour(currentPageIndex);
            } else {
              setIsTouring(false);
            }
          },
        });

        driverRef.current = driverObj;
        setIsTouring(true);
        driverObj.drive();
      }, 1200);
    };

    runPageTour(0);
  }, [router, canAccessRoute]);

  // Mark tour as completed in DB
  const markTourCompleted = async () => {
    if (!activeBusiness) return;

    try {
      const existingConfig = activeBusiness.theme_config || {};
      await supabase
        .from("businesses")
        .update({
          theme_config: {
            ...existingConfig,
            walkthrough_completed: true,
          },
        })
        .eq("id", activeBusiness.id);
    } catch (e) {
      console.error("[Walkthrough] Error marking tour completed:", e);
    }

    localStorage.setItem(`walkthrough_completed_${activeBusiness.id}`, "true");
  };

  // Check if this is the first visit (trigger full tour)
  useEffect(() => {
    if (!activeBusiness || hasCheckedFirstVisit || pathname !== "/dashboard") return;

    const localKey = `walkthrough_completed_${activeBusiness.id}`;
    const localCompleted = localStorage.getItem(localKey);
    const dbCompleted = activeBusiness.theme_config?.walkthrough_completed;

    if (!localCompleted && !dbCompleted) {
      // First visit — start full tour after a delay
      setHasCheckedFirstVisit(true);
      setTimeout(() => {
        startFullTour();
      }, 2000);
    } else {
      setHasCheckedFirstVisit(true);
    }
  }, [activeBusiness, pathname, hasCheckedFirstVisit, startFullTour]);

  return (
    <WalkthroughContext.Provider value={{ startPageTour, startFullTour, isTouring }}>
      {children}
      <style jsx global>{walkthroughCss}</style>
    </WalkthroughContext.Provider>
  );
}
