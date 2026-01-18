"use client";

/**
 * Pattern Tests Page
 *
 * Test pattern matching by selecting an image and screenshot,
 * then running the qontinui library's find action via the runner.
 */

import { RequireProject } from "@/components/require-project";
import PatternMatchingTest from "@/components/PatternMatching/PatternMatchingTest";

export default function PatternTestsPage() {
  return (
    <RequireProject pageName="Pattern Tests">
      <PatternMatchingTest className="h-[calc(100vh-120px)]" />
    </RequireProject>
  );
}
