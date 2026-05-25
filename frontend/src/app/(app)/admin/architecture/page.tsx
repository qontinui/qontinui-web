"use client";

/**
 * Qontinui Architecture Views Hub
 *
 * Shows architecture diagrams for the unified runner architecture
 * where all compute goes through qontinui-runner instead of qontinui-api.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ArchitectureDiagrams from "@/components/admin/architecture/ArchitectureDiagrams";

export default function ArchitecturePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Only redirect once auth has resolved to a *loaded* non-superuser.
    // While `loading` is true we must not act on a transiently-null user.
    if (loading) return;
    if (user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
    }
  }, [loading, user, router]);

  // Auth still resolving — show a spinner, never a blank page. (The (app)
  // layout's auth gate normally guarantees a loaded user here, but guarding
  // locally keeps a direct visit / context edge-case from flashing blank.)
  if (loading || !user) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  // Loaded, but not an admin: show a clear access-denied state instead of a
  // blank `return null` while the redirect (above) navigates away.
  if (!user.is_superuser) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <h1 className="text-lg font-semibold">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Admin privileges are required to view this page. Redirecting…
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/build/workflows")}
          >
            Go to Workflows
          </Button>
        </div>
      </div>
    );
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
