"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Loader2, Monitor, History, Key, Plus } from "lucide-react"
import { CreateTokenDialog } from "@/components/runners/CreateTokenDialog"
import { RunnerTokenCard } from "@/components/runners/RunnerTokenCard"
import { ActiveConnectionsList } from "@/components/runners/ActiveConnectionsList"
import { ConnectionHistoryTable } from "@/components/runners/ConnectionHistoryTable"
import {
  useRunnerTokens,
  useActiveConnections,
  useRevokeRunnerToken,
  useDeleteRunnerToken,
} from "@/hooks/useRunners"
import { toast } from "sonner"

export default function RunnersPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("active");

  const { data: tokens, isLoading: tokensLoading } = useRunnerTokens();
  const { data: activeConnections } = useActiveConnections(5000);
  const revokeMutation = useRevokeRunnerToken();
  const deleteMutation = useDeleteRunnerToken();

  const handleBackToDashboard = () => {
    router.push('/dashboard');
  };

  const handleRevokeToken = async (tokenId: string) => {
    try {
      await revokeMutation.mutateAsync(tokenId);
    } catch (error) {
      console.error('Failed to revoke token:', error);
    }
  };

  const handleDeleteToken = async (tokenId: string) => {
    try {
      await deleteMutation.mutateAsync(tokenId);
    } catch (error) {
      console.error('Failed to delete token:', error);
    }
  };

  const handleViewConnections = (tokenId: string) => {
    // Switch to history tab and filter by token
    setActiveTab("history");
    toast.info("Viewing connections for selected token");
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
    router.push('/');
    return null;
  }

  const activeConnectionCount = activeConnections?.length || 0;

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
              Runner Management
            </h1>
            {activeConnectionCount > 0 && (
              <Badge variant="outline" className="border-green-500/50 text-green-500">
                {activeConnectionCount} Active
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Manage Desktop Runners</h2>
          <p className="text-gray-400">
            Create tokens, monitor connections, and view connection history for your desktop runners
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-[#1A1A1B] border border-gray-800">
            <TabsTrigger value="active" className="gap-2">
              <Monitor className="w-4 h-4" />
              Active Connections
              {activeConnectionCount > 0 && (
                <Badge variant="outline" className="ml-1 border-green-500/50 text-green-500 text-xs">
                  {activeConnectionCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              Connection History
            </TabsTrigger>
            <TabsTrigger value="tokens" className="gap-2">
              <Key className="w-4 h-4" />
              Runner Tokens
              {tokens && (
                <Badge variant="outline" className="ml-1 border-[#00D9FF]/50 text-[#00D9FF] text-xs">
                  {tokens.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Active Connections */}
          <TabsContent value="active" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Active Connections</h3>
                <p className="text-sm text-gray-400">
                  Real-time view of currently connected runners (auto-refreshes every 5 seconds)
                </p>
              </div>
            </div>
            <ActiveConnectionsList />
          </TabsContent>

          {/* Tab 2: Connection History */}
          <TabsContent value="history" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Connection History</h3>
                <p className="text-sm text-gray-400">
                  View and search past runner connections
                </p>
              </div>
            </div>
            <ConnectionHistoryTable />
          </TabsContent>

          {/* Tab 3: Runner Tokens */}
          <TabsContent value="tokens" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Runner Tokens</h3>
                <p className="text-sm text-gray-400">
                  Manage authentication tokens for desktop runners
                </p>
              </div>
              <CreateTokenDialog />
            </div>

            {tokensLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-[#00D9FF]" />
                <span className="ml-3 text-gray-400">Loading tokens...</span>
              </div>
            ) : !tokens || tokens.length === 0 ? (
              <Card className="bg-[#1A1A1B] border-gray-800 p-12">
                <div className="text-center">
                  <Key className="w-16 h-16 mx-auto text-gray-600 mb-4" />
                  <h3 className="text-xl font-semibold text-gray-300 mb-2">
                    No Runner Tokens
                  </h3>
                  <p className="text-gray-400 mb-6">
                    Create your first runner token to connect a desktop runner
                  </p>
                  <CreateTokenDialog>
                    <Button className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black">
                      <Plus className="w-4 h-4 mr-2" />
                      Create Your First Token
                    </Button>
                  </CreateTokenDialog>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {tokens.map((token) => (
                  <RunnerTokenCard
                    key={token.id}
                    token={token}
                    onRevoke={handleRevokeToken}
                    onDelete={handleDeleteToken}
                    onViewConnections={handleViewConnections}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
