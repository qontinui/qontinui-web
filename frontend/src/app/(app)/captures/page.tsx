'use client';

import { CaptureListPage } from '@/components/captures/CaptureListPage';
import { RequireProject } from '@/components/require-project';

export default function CapturesPage() {
  return (
    <RequireProject pageName="Captures">
      <CaptureListPage />
    </RequireProject>
  );
}
