"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FleetOverview,
  LandedFeaturesPanel,
  MergeTrain,
} from "@/components/operations";
import { Activity } from "lucide-react";

export default function OperationsPage() {
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
          <Activity className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Operations</h1>
            <p className="text-xs text-muted-foreground">
              Cross-machine fleet view — runners, Claude Code sessions, and
              active workflows.
            </p>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4 space-y-4">
          {/*
           * Merge train anchors at the top — it is the demo's primary
           * visual anchor per `plans/2026-05-18-coordination-layer-demos.md`
           * §5.2.1. FleetOverview below shows the machines + Claude
           * sessions. LandedFeaturesPanel surfaces the deployed demo
           * features via embedded iframes (§5.2.2).
           */}
          <MergeTrain />
          <FleetOverview />
          <LandedFeaturesPanel />
        </div>
      </ScrollArea>
    </div>
  );
}
