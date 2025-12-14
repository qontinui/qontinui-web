"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeficiencyList } from "@/components/testing/DeficiencyList";
import { useDeficiencies } from "@/hooks/useTesting";
import { ArrowLeft, TrendingUp, BarChart3 } from "lucide-react";
import type { DeficiencyAlert } from "@/hooks/useTestStream";

export default function ProjectDeficienciesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const testRunId = searchParams.get("run");

  const { data: deficienciesResponse, isLoading } = useDeficiencies({
    project_id: projectId,
    test_run_id: testRunId || undefined,
  });

  // Convert Deficiency[] to DeficiencyAlert[] format
  const deficiencyAlerts: DeficiencyAlert[] = useMemo(() => {
    if (!deficienciesResponse?.items) return [];
    return deficienciesResponse.items.map((d) => ({
      id: d.id,
      severity: d.severity,
      title: d.title,
      description: d.description,
      stateName: d.state_name,
      timestamp: d.created_at,
    }));
  }, [deficienciesResponse]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading || isLoading) {
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
              Deficiency Management
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
              onClick={() => router.push(`/projects/${projectId}/testing/coverage`)}
              className="border-gray-700 hover:border-[#F59E0B] hover:text-[#F59E0B]"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Coverage
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">Deficiencies</h2>
          <p className="text-gray-400">
            Track and manage deficiencies found during testing
          </p>
        </div>

        {deficiencyAlerts.length > 0 ? (
          <DeficiencyList deficiencies={deficiencyAlerts} />
        ) : (
          <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
            <CardContent className="p-12 text-center">
              <div className="text-gray-400">
                No deficiencies found for this project
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
