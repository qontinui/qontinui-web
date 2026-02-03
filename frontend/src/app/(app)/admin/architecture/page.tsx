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
import { Home, Shield, ArrowLeft } from "lucide-react";
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
      router.push("/dashboard");
      return;
    }
  }, [user, authLoading, router]);

  // Don't render until auth is confirmed
  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto">
        {/* Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/admin")}
              className="hover:bg-primary/10"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Admin
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push("/admin")}
              className="flex items-center gap-2"
            >
              <Shield className="h-4 w-4" />
              Admin
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2"
            >
              <Home className="h-4 w-4" />
              Dashboard
            </Button>
          </div>
        </div>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Qontinui Architecture</h1>
          <p className="text-muted-foreground">
            Architecture diagrams and technical documentation
          </p>
        </div>

        {/* Architecture Diagrams */}
        <ArchitectureDiagrams />
      </div>
    </div>
  );
}
