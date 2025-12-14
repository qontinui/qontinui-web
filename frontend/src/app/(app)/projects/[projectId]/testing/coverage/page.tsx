"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverageTrendChart } from "@/components/testing/CoverageTrendChart";
import { ArrowLeft, TrendingUp, BarChart3, CheckCircle2, AlertTriangle } from "lucide-react";

export default function ProjectCoveragePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

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
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push(`/projects/${projectId}/testing`)}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#F59E0B] to-[#EF4444] bg-clip-text text-transparent">
              Test Coverage
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/projects/${projectId}/testing`)}
              className="border-gray-700 hover:border-[#F59E0B] hover:text-[#F59E0B]"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Test Runs
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/projects/${projectId}/testing/deficiencies`)}
              className="border-gray-700 hover:border-[#EF4444] hover:text-[#EF4444]"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              Deficiencies
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Coverage Analysis</h2>
          <p className="text-gray-400">
            Track test coverage trends and identify gaps in your testing strategy
          </p>
        </div>

        {/* Coverage Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-400">
                Overall Coverage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-3xl font-bold text-[#F59E0B]">--</div>
                  <div className="text-xs text-gray-500 mt-1">
                    No data available
                  </div>
                </div>
                <TrendingUp className="w-8 h-8 text-[#F59E0B]/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-400">
                Passing Tests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-3xl font-bold text-green-500">--</div>
                  <div className="text-xs text-gray-500 mt-1">
                    No data available
                  </div>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-400">
                Failing Tests
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-3xl font-bold text-red-500">--</div>
                  <div className="text-xs text-gray-500 mt-1">
                    No data available
                  </div>
                </div>
                <AlertTriangle className="w-8 h-8 text-red-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Coverage Trends Chart */}
        <CoverageTrendChart projectId={projectId} />
      </main>
    </div>
  );
}
