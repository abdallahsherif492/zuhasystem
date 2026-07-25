"use client";

import { useBusiness } from "@/contexts/BusinessContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { 
  Loader2, Settings, ShieldCheck, Store, PlusCircle, Check, ChevronDown, Building2, Sparkles 
} from "lucide-react";

export function BusinessSwitcher() {
  const { activeBusiness, businesses, setActiveBusiness, isSystemAdmin, loading, userRole } = useBusiness();
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border/40 bg-background/50">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">جاري التحميل...</span>
      </div>
    );
  }

  if (!activeBusiness) return null;

  const handleCreateNewBusiness = () => {
    router.push("/onboarding");
  };

  return (
    <div className="flex items-center gap-2 font-sans">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-10 px-3 py-2 rounded-xl border-border/60 bg-background/80 hover:bg-muted/60 hover:border-primary/40 transition-all flex items-center justify-between gap-3 shadow-sm min-w-[210px] max-w-[260px] group"
          >
            <div className="flex items-center gap-2.5 overflow-hidden text-right">
              {/* Business Avatar / Logo */}
              <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                {activeBusiness.logo_url ? (
                  <img src={activeBusiness.logo_url} alt={activeBusiness.name} className="h-full w-full object-cover" />
                ) : (
                  <Store className="h-3.5 w-3.5" />
                )}
              </div>

              {/* Business Name & Status */}
              <div className="flex flex-col items-start truncate">
                <span className="text-xs font-bold text-foreground truncate max-w-[140px]">
                  {activeBusiness.name}
                </span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1 font-normal">
                  {activeBusiness.subscription_status === 'active' ? (
                    <span className="text-emerald-600 font-medium">نشط ✓</span>
                  ) : (
                    <span className="text-amber-600 font-medium">فترة تجريبية</span>
                  )}
                </span>
              </div>
            </div>

            <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-transform group-data-[state=open]:rotate-180 shrink-0" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64 p-2 rounded-2xl shadow-xl border-border/60 backdrop-blur-xl bg-background/95">
          {/* Header Label */}
          <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground font-medium flex items-center justify-between">
            <span>القطاعات والمتاجر المسجلة</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono">
              {businesses.length}
            </Badge>
          </DropdownMenuLabel>

          <DropdownMenuSeparator className="my-1" />

          {/* List of Business Profiles */}
          <DropdownMenuGroup className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {businesses.map((b) => {
              const isSelected = b.business.id === activeBusiness.id;
              return (
                <DropdownMenuItem
                  key={b.business.id}
                  onClick={() => setActiveBusiness(b.business.id)}
                  className={`flex items-center justify-between p-2 rounded-xl cursor-pointer transition-colors ${
                    isSelected 
                      ? "bg-primary/10 text-primary font-semibold border border-primary/20" 
                      : "hover:bg-muted/70 text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                      isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {b.business.logo_url ? (
                        <img src={b.business.logo_url} alt={b.business.name} className="h-full w-full object-cover rounded-lg" />
                      ) : (
                        b.business.name ? b.business.name.charAt(0).toUpperCase() : 'S'
                      )}
                    </div>
                    <div className="flex flex-col truncate text-right">
                      <span className="text-xs truncate">{b.business.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">ID: {b.business.id.substring(0, 6)}...</span>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="h-4 w-4 text-primary shrink-0 mr-1" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="my-1.5" />

          {/* Create New Business Profile Option */}
          <DropdownMenuItem
            onClick={handleCreateNewBusiness}
            className="flex items-center gap-2 p-2 rounded-xl cursor-pointer text-primary hover:bg-primary/10 font-medium text-xs transition-colors"
          >
            <PlusCircle className="h-4 w-4 text-primary" />
            <span>إنشاء بروفايل تجاري جديد +</span>
          </DropdownMenuItem>

          {/* System Admin Link (If Admin) */}
          {isSystemAdmin && (
            <>
              <DropdownMenuSeparator className="my-1.5" />
              <DropdownMenuItem
                onClick={() => router.push("/system-admin")}
                className="flex items-center gap-2 p-2 rounded-xl cursor-pointer text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 font-medium text-xs transition-colors"
              >
                <Settings className="h-4 w-4 text-red-600" />
                <span>لوحة تحكم النظام (System Admin)</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* God Mode Indicator */}
      {userRole === 'Platform Admin' && (
        <div className="hidden sm:flex items-center gap-1 text-[11px] font-bold text-red-500 bg-red-50 dark:bg-red-950/50 px-2 py-1 rounded-lg border border-red-200 dark:border-red-900">
          <ShieldCheck className="h-3.5 w-3.5" /> God Mode
        </div>
      )}
    </div>
  );
}
