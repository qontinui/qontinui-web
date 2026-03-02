import { useState, useCallback } from "react";
import { WorkflowDocumentationService } from "@/services/workflow-documentation-service";

export function useViewerActions(workflowId: string, workflowName: string) {
  const [copiedLink, setCopiedLink] = useState(false);

  const copyLinkToSection = useCallback((id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, []);

  const handleExport = useCallback(
    (format: "markdown" | "html" | "pdf") => {
      const docService = WorkflowDocumentationService.getInstance();
      const exported = docService.exportDocumentation(workflowId, {
        format,
        includeTOC: true,
        includeMetadata: true,
        includeDiagrams: true,
        includeComments: true,
      });

      if (exported) {
        const blob = new Blob([exported], {
          type: format === "html" ? "text/html" : "text/markdown",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${workflowName}-docs.${format === "pdf" ? "pdf" : format === "html" ? "html" : "md"}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    },
    [workflowId, workflowName]
  );

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return {
    copiedLink,
    copyLinkToSection,
    handleExport,
    handlePrint,
  };
}
