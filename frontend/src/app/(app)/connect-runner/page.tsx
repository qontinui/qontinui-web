"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  Loader2,
  Monitor,
  Settings,
  ExternalLink,
} from "lucide-react";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { AutomationStreamingCard } from "@/components/profile/automation-streaming-card";

export default function ConnectRunnerPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const { connections: activeConnections } = useRealtimeConnections();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const handleBackToDashboard = () => {
    router.push("/dashboard");
  };

  const handleDownloadRunner = () => {
    // TODO: Link to actual download page or GitHub releases
    window.open("https://github.com/qontinui/qontinui-runner/releases", "_blank");
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
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToDashboard}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Connect Runner
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold mb-2">
                Connect Desktop Runner
              </h2>
              <p className="text-gray-400">
                Download and log into the Qontinui Runner app to connect your
                desktop for automation
              </p>
            </div>
            <div className="flex gap-3">
              <Link href="/runners">
                <Button variant="outline" className="border-gray-700">
                  <Settings className="w-4 h-4 mr-2" />
                  Manage Runners
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Runner Connection Status Card */}
        <Card
          className={`mb-6 p-4 border ${activeConnections && activeConnections.length > 0 ? "bg-green-950/30 border-green-500/50" : "bg-yellow-950/30 border-yellow-500/50"}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Status Light */}
              <div className="relative">
                <div
                  className={`w-4 h-4 rounded-full ${activeConnections && activeConnections.length > 0 ? "bg-green-500" : "bg-yellow-500"}`}
                />
                {activeConnections && activeConnections.length > 0 && (
                  <div className="absolute inset-0 w-4 h-4 rounded-full bg-green-500 animate-ping opacity-75" />
                )}
              </div>

              {/* Status Text */}
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-semibold ${activeConnections && activeConnections.length > 0 ? "text-green-400" : "text-yellow-400"}`}
                  >
                    {activeConnections && activeConnections.length > 0
                      ? "Runner Connected"
                      : "No Runner Connected"}
                  </span>
                </div>
                {activeConnections && activeConnections.length > 0 ? (
                  <div className="text-sm text-gray-400 mt-1">
                    {activeConnections.map((conn) => (
                      <div key={conn.id} className="flex items-center gap-2">
                        <Monitor className="w-3 h-3" />
                        <span className="text-white">{conn.runner_name}</span>
                        {conn.project_name && (
                          <>
                            <span className="text-gray-500">-</span>
                            <span className="text-[#00D9FF]">
                              {conn.project_name}
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">
                    Follow the steps below to connect your desktop runner
                  </p>
                )}
              </div>
            </div>

            {/* Connection Count Badge */}
            {activeConnections && activeConnections.length > 0 && (
              <Badge
                variant="outline"
                className="border-green-500/50 text-green-400"
              >
                {activeConnections.length} Active
              </Badge>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          {/* Automation Streaming Settings */}
          <AutomationStreamingCard context="connect-runner" />

          {/* How to Connect - Step by Step */}
          <Card className="bg-[#1A1A1B] border-gray-800 p-6">
            <h3 className="text-xl font-semibold mb-6">How to Connect</h3>
            <div className="space-y-6">
              {/* Step 1: Download */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] flex items-center justify-center text-black font-bold">
                    1
                  </div>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-lg mb-2">
                    Download Qontinui Runner
                  </h4>
                  <p className="text-gray-400 mb-3">
                    Download and install the desktop runner app for your
                    operating system.
                  </p>
                  <Button
                    onClick={handleDownloadRunner}
                    className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Runner
                    <ExternalLink className="w-3 h-3 ml-2" />
                  </Button>
                </div>
              </div>

              {/* Step 2: Login */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] flex items-center justify-center text-black font-bold">
                    2
                  </div>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-lg mb-2">
                    Log in with your Qontinui account
                  </h4>
                  <p className="text-gray-400">
                    Open the runner app and log in using the same email and
                    password you use for this website. The runner will
                    automatically register with your account.
                  </p>
                </div>
              </div>

              {/* Step 3: Select Project */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] flex items-center justify-center text-black font-bold">
                    3
                  </div>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-lg mb-2">
                    Select a project in the runner
                  </h4>
                  <p className="text-gray-400">
                    Choose which project to work with from the runner app. Your
                    projects will be synced automatically after login.
                  </p>
                </div>
              </div>

              {/* Step 4: Ready */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] flex items-center justify-center text-black font-bold">
                    4
                  </div>
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-lg mb-2">
                    Start automating!
                  </h4>
                  <p className="text-gray-400">
                    Once connected, you can send workflow configurations
                    directly from the web app to your runner for immediate
                    execution. Use the &quot;Send to Runner&quot; option in the
                    workflow editor to execute automations on your desktop. The
                    runner status will show as &quot;Connected&quot; above.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* All Connected Runners */}
          {activeConnections && activeConnections.length > 0 && (
            <Card className="bg-[#1A1A1B] border-gray-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">Connected Runners</h3>
                <Link href="/runners">
                  <Button variant="ghost" size="sm" className="text-gray-400">
                    View All
                    <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
                  </Button>
                </Link>
              </div>
              <div className="space-y-3">
                {activeConnections.map((conn) => (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between bg-[#0A0A0B] border border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Monitor className="w-5 h-5 text-gray-400" />
                        <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" />
                      </div>
                      <div>
                        <div className="font-medium">{conn.runner_name}</div>
                        <div className="text-sm text-gray-500">
                          {conn.project_name || "No project selected"}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-green-500/50 text-green-400"
                    >
                      Connected
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
