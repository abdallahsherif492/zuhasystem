"use client";

import React, { createContext, useContext, useCallback, useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useBusiness } from "@/contexts/BusinessContext";
import { supabase } from "@/lib/supabase";
import { getPageSteps, getFullTourPages, WalkthroughStep } from "./walkthrough-steps";

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
  const { activeBusiness } = useBusiness();
  const pathname = usePathname();
  const router = useRouter();
  const [isTouring, setIsTouring] = useState(false);
  const [hasCheckedFirstVisit, setHasCheckedFirstVisit] = useState(false);
  const driverRef = useRef<any>(null);

  // Convert our steps to driver.js format
  const toDriverSteps = (steps: WalkthroughStep[]): DriveStep[] => {
    return steps.map((step) => ({
      element: step.element || undefined,
      popover: {
        title: step.popover.title,
        description: step.popover.description,
        side: step.popover.side || "bottom",
        align: step.popover.align || "center",
      },
    }));
  };

  // Start tour for a specific page
  const startPageTour = useCallback((pageId: string) => {
    const steps = getPageSteps(pageId);
    if (steps.length === 0) return;

    // Small delay to let DOM render
    setTimeout(() => {
      const driverObj = driver({
        showProgress: true,
        showButtons: ["next", "previous", "close"],
        nextBtnText: "التالي ←",
        prevBtnText: "→ السابق",
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
  }, []);

  // Start the full sequential tour across all pages
  const startFullTour = useCallback(() => {
    const pages = getFullTourPages();
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
          nextBtnText: "التالي ←",
          prevBtnText: "→ السابق",
          doneBtnText: pageIndex < pages.length - 1 ? "الصفحة التالية ←" : "🎉 تم!",
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
  }, [router]);

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
      <style jsx global>{`
        .ecommerx-walkthrough {
          background: #0F172A !important;
          color: white !important;
          border-radius: 16px !important;
          padding: 20px 24px !important;
          max-width: 420px !important;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4) !important;
          border: 1px solid rgba(99, 102, 241, 0.3) !important;
          direction: rtl !important;
          text-align: right !important;
          font-family: inherit !important;
        }
        .ecommerx-walkthrough .driver-popover-title {
          font-size: 18px !important;
          font-weight: 800 !important;
          color: white !important;
          margin-bottom: 8px !important;
          line-height: 1.6 !important;
        }
        .ecommerx-walkthrough .driver-popover-description {
          font-size: 14px !important;
          color: rgba(255, 255, 255, 0.85) !important;
          line-height: 2 !important;
          white-space: pre-line !important;
        }
        .ecommerx-walkthrough .driver-popover-progress-text {
          color: rgba(255, 255, 255, 0.5) !important;
          font-size: 12px !important;
        }
        .ecommerx-walkthrough .driver-popover-navigation-btns {
          direction: ltr !important;
          gap: 8px !important;
        }
        .ecommerx-walkthrough .driver-popover-next-btn,
        .ecommerx-walkthrough .driver-popover-prev-btn {
          background: #6366F1 !important;
          color: white !important;
          border: none !important;
          border-radius: 8px !important;
          padding: 8px 16px !important;
          font-weight: 600 !important;
          font-size: 13px !important;
          transition: all 0.2s !important;
        }
        .ecommerx-walkthrough .driver-popover-prev-btn {
          background: rgba(255,255,255,0.1) !important;
        }
        .ecommerx-walkthrough .driver-popover-next-btn:hover {
          background: #4F46E5 !important;
          transform: scale(1.02) !important;
        }
        .ecommerx-walkthrough .driver-popover-close-btn {
          color: rgba(255, 255, 255, 0.6) !important;
        }
        .ecommerx-walkthrough .driver-popover-close-btn:hover {
          color: white !important;
        }
        .driver-overlay, .driver-overlay path {
          fill: rgba(15, 23, 42, 0.35) !important;
          background: rgba(15, 23, 42, 0.35) !important;
        }
      `}</style>
    </WalkthroughContext.Provider>
  );
}
