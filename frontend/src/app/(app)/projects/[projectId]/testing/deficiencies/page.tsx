"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { DeficiencyList } from "@/components/testing/DeficiencyList";
import { TrendingUp, BarChart3 } from "lucide-react";

export default function ProjectDeficienciesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const testRunId = searchParams.get("run");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-foreground">
          Deficiency Management
        </h1>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/projects/${projectId}/testing`)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Test Runs
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/projects/${projectId}/testing/coverage`)
            }
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            Coverage
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            Track and manage deficiencies found during testing
          </p>
        </div>

        <DeficiencyList
          projectId={projectId}
          testRunId={testRunId || undefined}
        />
      </main>
    </div>
  );
}
