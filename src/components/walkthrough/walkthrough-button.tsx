"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useWalkthrough } from "./walkthrough-provider";
import { useLanguage } from "@/contexts/LanguageContext";
import { HelpCircle, Play, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const { direction } = useLanguage();
  const { startPageTour, startFullTour, isTouring } = useWalkthrough();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const pageId = getPageIdFromPath(pathname);

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!pageId || isTouring) return null;

  // The chat widget owns the bottom-right corner, so this sits bottom-left.
  // In LTR the sidebar also occupies the left, so clear its 16rem width.
  const isRtl = direction === "rtl";

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed bottom-6 z-50 print:hidden",
        isRtl ? "left-6" : "left-6 md:left-[17.5rem]"
      )}
    >
      {open && (
        <div className="absolute bottom-full mb-3 w-64 rounded-2xl bg-[#0F172A] border border-indigo-500/25 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm font-bold text-white">محتاج مساعدة؟</span>
            <button
              onClick={() => setOpen(false)}
              className="text-white/40 hover:text-white transition-colors"
              aria-label="إغلاق"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              startPageTour(pageId);
            }}
            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-start"
          >
            <Play className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-semibold text-white">اشرحلي الصفحة دي</span>
              <span className="block text-xs text-white/50 mt-0.5">جولة سريعة على عناصر الصفحة الحالية</span>
            </span>
          </button>

          <button
            onClick={() => {
              setOpen(false);
              startFullTour();
            }}
            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-start border-t border-white/10"
          >
            <RotateCcw className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <span className="block text-sm font-semibold text-white">الجولة الكاملة من الأول</span>
              <span className="block text-xs text-white/50 mt-0.5">شرح النظام كله خطوة بخطوة</span>
            </span>
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-2 h-12 px-4 rounded-full bg-gradient-to-br from-[#6366F1] to-[#4F46E5] text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 hover:scale-105 transition-all duration-300"
        aria-expanded={open}
        aria-label="شرح واستخدام النظام"
      >
        <HelpCircle className="w-5 h-5 shrink-0" />
        <span className="text-sm font-bold whitespace-nowrap">شرح الصفحة</span>
      </button>
    </div>
  );
}
