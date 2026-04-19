"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Server } from "lucide-react";
import { RunnerSetupCallout } from "@/components/server-runners/RunnerSetupCallout";
import { RunnerFleetTable } from "@/components/server-runners/RunnerFleetTable";
import { RunnerTokenList } from "@/components/server-runners/RunnerTokenList";

export default function RunnerFleetPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-surface-raised to-surface-canvas text-white">
      <header className="border-b border-border-subtle bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/runners")}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Runners
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Server className="w-5 h-5 text-brand-primary" aria-hidden />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              Server-Mode Runner Fleet
            </h1>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-1">Fleet overview</h2>
          <p className="text-text-muted">
            Long-running runners that register with the backend and accept
            dispatched workflows. Distinct from connected desktop runners on the{" "}
            <em>Runners</em> page.
          </p>
        </div>

        <RunnerSetupCallout />

        <RunnerFleetTable />

        <RunnerTokenList />
      </main>
    </div>
  );
}
