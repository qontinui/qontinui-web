"use client";

import { RecordingListPage } from "@/components/recordings/RecordingListPage";
import { RequireProject } from "@/components/require-project";

export default function RecordingsPage() {
  return (
    <RequireProject pageName="Recordings">
      <RecordingListPage />
    </RequireProject>
  );
}
