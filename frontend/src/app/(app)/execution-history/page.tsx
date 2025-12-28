"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { RequireProject } from "@/components/require-project";
import { ExecutionHistoryView } from "@/components/execution/ExecutionHistoryView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  History,
  Search,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

export default function ExecutionHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const runIdParam = searchParams.get("runId");

  const [selectedRunId, setSelectedRunId] = useState<string | null>(runIdParam);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  // Update URL when run is selected
  useEffect(() => {
    if (selectedRunId) {
      const url = new URL(window.location.href);
      url.searchParams.set("runId", selectedRunId);
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedRunId]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="Execution History">
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        {/* Header */}
        <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <History className="w-6 h-6 text-[#F59E0B]" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#F59E0B] to-[#F97316] bg-clip-text text-transparent">
                Execution History
              </h1>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          {selectedRunId ? (
            <ExecutionHistoryView
              runId={selectedRunId}
              onBack={() => setSelectedRunId(null)}
              showBackButton={true}
            />
          ) : (
            <div className="space-y-6">
              {/* Run ID Input */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                <CardHeader>
                  <CardTitle className="text-lg text-white flex items-center gap-2">
                    <Search className="w-5 h-5" />
                    View Execution Run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4">
                    <Input
                      placeholder="Enter execution run ID (UUID)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 bg-gray-800/50 border-gray-700"
                    />
                    <Button
                      onClick={() => {
                        if (searchQuery.trim()) {
                          setSelectedRunId(searchQuery.trim());
                        }
                      }}
                      disabled={!searchQuery.trim()}
                      className="bg-[#F59E0B] hover:bg-[#F59E0B]/80"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      View Run
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Enter the UUID of an execution run to view its tree event
                    history.
                  </p>
                </CardContent>
              </Card>

              {/* Info Card */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
                <CardContent className="py-12">
                  <div className="text-center">
                    <History className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                    <h3 className="text-xl font-medium text-gray-300 mb-2">
                      Execution Tree Events
                    </h3>
                    <p className="text-sm text-gray-500 max-w-md mx-auto">
                      View detailed tree events for any execution run. This
                      shows the hierarchical structure of workflows, actions,
                      and transitions with timing, status, and metadata
                      information.
                    </p>
                    <div className="flex justify-center gap-4 mt-6">
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Success
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <XCircle className="w-4 h-4 text-red-500" />
                        Failed
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <Clock className="w-4 h-4 text-blue-500" />
                        Running
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </RequireProject>
  );
}
