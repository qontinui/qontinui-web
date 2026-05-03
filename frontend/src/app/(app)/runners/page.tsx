"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Monitor, History, KeyRound } from "lucide-react";
import { ActiveConnectionsList } from "@/components/runners/ActiveConnectionsList";
import { ConnectionHistoryTable } from "@/components/runners/ConnectionHistoryTable";
import { RunnerTokenList } from "@/components/server-runners/RunnerTokenList";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";

export default function RunnersPage() {
  const discoveredSpec = useDiscoveredSpec("runners");
  usePageSpecs(
    discoveredSpec ? { runners: discoveredSpec.config as SpecConfig } : {}
  );
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("online");

  const { runners: onlineRunners } = useRealtimeConnections();

  const handleBackToDashboard = () => {
    router.push("/build/workflows");
  };

  // Show loading while auth is checking
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

  // Don't render anything if no user (will redirect)
  if (!user) {
    router.push("/");
    return null;
  }

  const onlineCount = onlineRunners?.length || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-surface-raised to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToDashboard}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              Runner Management
            </h1>
            {onlineCount > 0 && (
              <Badge
                variant="outline"
                className="border-green-500/50 text-green-500"
              >
                {onlineCount} Online
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Manage Runners</h2>
          <p className="text-text-muted">
            Online runners, session history, and the auth tokens runners use to
            register themselves.
          </p>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList className="bg-surface-raised border border-border-subtle">
            <TabsTrigger value="online" className="gap-2">
              <Monitor className="w-4 h-4" />
              Online Runners
              {onlineCount > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 border-green-500/50 text-green-500 text-xs"
                >
                  {onlineCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              Session History
            </TabsTrigger>
            <TabsTrigger value="tokens" className="gap-2">
              <KeyRound className="w-4 h-4" />
              Auth Tokens
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Online Runners */}
          <TabsContent value="online" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Online Runners</h3>
                <p className="text-sm text-text-muted">
                  Runners reachable right now — anything healthy, degraded, or
                  starting.
                </p>
              </div>
            </div>
            <ActiveConnectionsList />
          </TabsContent>

          {/* Tab 2: Session History */}
          <TabsContent value="history" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Session History</h3>
                <p className="text-sm text-text-muted">
                  Audit log of past WebSocket sessions per runner.
                </p>
              </div>
            </div>
            <ConnectionHistoryTable />
          </TabsContent>

          {/* Tab 3: Auth Tokens */}
          <TabsContent value="tokens" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Runner Auth Tokens</h3>
                <p className="text-sm text-text-muted">
                  Long-lived bearer tokens that runners use to register and
                  authenticate against this account.
                </p>
              </div>
            </div>
            <RunnerTokenList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
