"use client";

import { usePathname } from "next/navigation";
import { useWalkthrough } from "./walkthrough-provider";
import { HelpCircle } from "lucide-react";

// Map route to pageId
function getPageIdFromPath(pathname: string): string | null {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname === "/accounting") return "accounting";
  if (pathname === "/products") return "products";
  if (pathname.startsWith("/orders")) {
    if (pathname.includes("/print")) return null;
    return "orders";
  }
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

export function WalkthroughButton() {
  const pathname = usePathname();
  const { startPageTour, isTouring } = useWalkthrough();

  const pageId = getPageIdFromPath(pathname);

  // Don't show on pages we don't have a tour for
  if (!pageId || isTouring) return null;

  return (
    <button
      onClick={() => startPageTour(pageId)}
      className="fixed bottom-6 left-6 z-50 group"
      title="شرح الصفحة"
      aria-label="Help walkthrough"
    >
      <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-[#6366F1] to-[#4F46E5] text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 hover:scale-110 transition-all duration-300 cursor-pointer">
        <HelpCircle className="w-6 h-6" />
        
        {/* Pulse ring */}
        <span className="absolute inset-0 rounded-full border-2 border-indigo-400/40 animate-ping" style={{ animationDuration: '3s' }} />
      </div>
      
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#0F172A] text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap pointer-events-none border border-indigo-500/20">
        شرح الصفحة ❓
      </div>
    </button>
  );
}
