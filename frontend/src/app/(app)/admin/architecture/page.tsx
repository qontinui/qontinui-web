"use client";

/**
 * Qontinui Architecture Views Hub
 *
 * Shows architecture diagrams for the unified runner architecture
 * where all compute goes through qontinui-runner instead of qontinui-api.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ArchitectureDiagrams from "@/components/admin/architecture/ArchitectureDiagrams";

export default function ArchitecturePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
      return;
    }
  }, [user, authLoading, router]);

  // Don't render until auth is confirmed
  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin")}
            data-testid="admin-architecture-back-btn"
          >
            Admin
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">Architecture</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <ArchitectureDiagrams />
      </div>
    </div>
  );
}
