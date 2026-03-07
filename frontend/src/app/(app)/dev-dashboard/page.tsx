"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FleetOverview } from "@/components/dev-dashboard";
import { LayoutDashboard } from "lucide-react";

export default function DevDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (!user) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Dev Dashboard</h1>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4">
          <FleetOverview />
        </div>
      </ScrollArea>
    </div>
  );
}
