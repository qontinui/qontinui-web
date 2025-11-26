'use client';

import { Suspense } from 'react';
import AutomationBuilder from "@/components/automation-builder";
import { RequireProject } from '@/components/require-project'
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic'

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
    </div>
  );
}

export default function AutomationBuilderPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="Workflows">
        <AutomationBuilder />
      </RequireProject>
    </Suspense>
  );
}
