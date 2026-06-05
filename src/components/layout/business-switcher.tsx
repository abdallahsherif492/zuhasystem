"use client";

import { useBusiness } from "@/contexts/BusinessContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Loader2, Settings, ShieldCheck } from "lucide-react";

export function BusinessSwitcher() {
  const { activeBusiness, businesses, setActiveBusiness, isSystemAdmin, loading, userRole } = useBusiness();
  const router = useRouter();

  if (loading) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }

  if (!activeBusiness) return null;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={activeBusiness.id}
        onValueChange={(val) => setActiveBusiness(val)}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select Business" />
        </SelectTrigger>
        <SelectContent>
          {businesses.map((b) => (
            <SelectItem key={b.business.id} value={b.business.id}>
              {b.business.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {userRole === 'Platform Admin' && (
        <div className="flex items-center gap-1 text-xs font-bold text-red-500 bg-red-50 dark:bg-red-950 px-2 py-1 rounded-md border border-red-200">
          <ShieldCheck className="h-3 w-3" /> God Mode
        </div>
      )}

      {isSystemAdmin && (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => router.push("/system-admin")}
          className="gap-2"
        >
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">System Admin</span>
        </Button>
      )}
    </div>
  );
}
