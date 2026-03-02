"use client";

import React from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowDocumentation } from "@/services/workflow-documentation-service";
import { cn } from "@/lib/utils";
import { useDocumentationSections } from "./_hooks/useDocumentationSections";
import { useViewerActions } from "./_hooks/useViewerActions";
import { ViewerSidebar } from "./_components/ViewerSidebar";
import { ViewerHeader } from "./_components/ViewerHeader";
import { ViewerContent } from "./_components/ViewerContent";

export interface DocumentationViewerProps {
  workflow: Workflow;
  documentation: WorkflowDocumentation;
  onEdit: () => void;
  className?: string;
}

export function DocumentationViewer({
  workflow,
  documentation,
  onEdit,
  className,
}: DocumentationViewerProps) {
  const {
    sections,
    toc,
    filteredSections,
    searchQuery,
    setSearchQuery,
    activeSection,
    collapsedSections,
    scrollToSection,
    toggleSection,
  } = useDocumentationSections(documentation.content);

  const { copiedLink, copyLinkToSection, handleExport, handlePrint } =
    useViewerActions(workflow.id, workflow.name);

  return (
    <div className={cn("flex h-full bg-background", className)}>
      <ViewerSidebar
        workflowName={workflow.name}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        toc={toc}
        activeSection={activeSection}
        collapsedSections={collapsedSections}
        onScrollToSection={scrollToSection}
        onToggleSection={toggleSection}
        firstSectionId={sections[0]?.id ?? ""}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <ViewerHeader
          workflowName={workflow.name}
          documentation={documentation}
          copiedLink={copiedLink}
          onCopyLink={() =>
            copyLinkToSection(activeSection || (sections[0]?.id ?? ""))
          }
          onExport={handleExport}
          onPrint={handlePrint}
          onEdit={onEdit}
        />

        <ViewerContent
          sections={filteredSections}
          searchQuery={searchQuery}
          collapsedSections={collapsedSections}
          onCopyLink={copyLinkToSection}
        />
      </div>
    </div>
  );
}
