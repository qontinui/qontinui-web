"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { RunnerMonitor, SessionHistory } from "@/components/runner";
import { Activity, History, LayoutDashboard, Shield } from "lucide-react";

export default function RunnerPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("monitor");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (!user) {
    return null;
  }

  return (
    <div className="container mx-auto py-8 h-screen flex flex-col">
      {/* Navigation Links */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard")}
          className="hover:bg-primary/10"
        >
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Dashboard
        </Button>
        {user.is_superuser && (
          <Button
            variant="ghost"
            onClick={() => router.push("/admin")}
            className="hover:bg-secondary/10"
          >
            <Shield className="mr-2 h-4 w-4" />
            Admin
          </Button>
        )}
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Activity className="h-8 w-8" />
          Automation Runner
        </h1>
        <p className="text-muted-foreground">
          Monitor real-time automation sessions and review session history
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="h-full flex flex-col"
        >
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="monitor" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Live Monitor
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Session History
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-h-0 mt-6">
            <TabsContent value="monitor" className="h-full mt-0">
              <RunnerMonitor />
            </TabsContent>

            <TabsContent value="history" className="h-full mt-0">
              <SessionHistory />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
