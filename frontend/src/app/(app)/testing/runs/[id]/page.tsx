'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { TestRunDetails } from '@/components/testing/TestRunDetails';
import { StateGraphVisualization } from '@/components/testing/StateGraphVisualization';
import { ArrowLeft } from 'lucide-react';
import { useTestRun } from '@/hooks/useTesting';
import { RequireProject } from '@/components/require-project';

export default function TestRunDetailPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const runId = params.id as string;

  const { data: run } = useTestRun(runId);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
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
    <RequireProject pageName="Test Run Details">
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-gray-800/50 bg-[#0A0A0B]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push('/testing/runs')}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              All Runs
            </Button>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
              Test Run Details
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="space-y-6">
          <TestRunDetails runId={runId} />

          {/* State Graph */}
          {run && (
            <StateGraphVisualization
              projectId={run.project_id}
              workflowId={run.workflow_id}
            />
          )}
        </div>
      </main>
    </div>
    </RequireProject>
  );
}
