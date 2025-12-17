"use client";

import { RAGTestingTab } from "@/components/RAGTesting/RAGTestingTab";
import { RequireProject } from "@/components/require-project";

export default function RAGTestingPage() {
  return (
    <RequireProject pageName="RAG Testing">
      <RAGTestingTab />
    </RequireProject>
  );
}
