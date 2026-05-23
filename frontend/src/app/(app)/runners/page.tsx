"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Monitor, History, KeyRound } from "lucide-react";
import { RegisteredDevicesList } from "@/components/runners/RegisteredDevicesList";
import { ConnectionHistoryTable } from "@/components/runners/ConnectionHistoryTable";
import { RunnerTokenList } from "@/components/server-runners/RunnerTokenList";
import { PairCodeMintCard } from "@/components/server-runners/PairCodeMintCard";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";

export default function RunnersPage() {
  const discoveredSpec = useDiscoveredSpec("runners");
  usePageSpecs(
    discoveredSpec ? { runners: discoveredSpec.config as SpecConfig } : {}
  );
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("devices");
  const [showOnlyOnline, setShowOnlyOnline] = useState(false);

  const { runners: onlineRunners } = useRealtimeConnections();

  const handleBackToDashboard = () => {
    router.push("/build/workflows");
  };

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
            All paired devices, session history, and the auth tokens runners
            use to register themselves.
          </p>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList className="bg-surface-raised border border-border-subtle">
            <TabsTrigger value="devices" className="gap-2">
              <Monitor className="w-4 h-4" />
              Devices
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

          {/* Tab 1: Devices (all registered, with online-only toggle) */}
          <TabsContent value="devices" className="space-y-6">
            <div className="flex justify-between items-center gap-4 flex-wrap">
              <div>
                <h3 className="text-xl font-semibold">Devices</h3>
                <p className="text-sm text-text-muted">
                  All devices paired to this account — online and offline.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="devices-online-only"
                  checked={showOnlyOnline}
                  onCheckedChange={setShowOnlyOnline}
                />
                <Label
                  htmlFor="devices-online-only"
                  className="text-sm cursor-pointer"
                >
                  Online only
                </Label>
              </div>
            </div>
            <RegisteredDevicesList showOnlyOnline={showOnlyOnline} />
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
                  Pair a new runner with a one-time code (recommended), or
                  create a long-lived bearer token for CI / advanced use.
                </p>
              </div>
            </div>
            {/* Pair codes are the recommended path; render above the
                long-lived-token card. */}
            <PairCodeMintCard />
            <RunnerTokenList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
