import * as React from "react";
import type { getWorkflowTestingService } from "@/services/workflow-testing";

interface UseImportExportParams {
  testingService: ReturnType<typeof getWorkflowTestingService>;
  loadData: () => void;
  setShowImportDialog: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useImportExport({
  testingService,
  loadData,
  setShowImportDialog,
}: UseImportExportParams) {
  const handleExportTests = React.useCallback(() => {
    const data = testingService.exportAll();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-tests-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [testingService]);

  const handleImportTests = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as string;
          testingService.importAll(data);
          loadData();
          setShowImportDialog(false);
        } catch (error) {
          alert(
            "Failed to import tests: " +
              (error instanceof Error ? error.message : "Unknown error")
          );
        }
      };
      reader.readAsText(file);
    },
    [testingService, loadData, setShowImportDialog]
  );

  return {
    handleExportTests,
    handleImportTests,
  };
}
