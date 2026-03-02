"use client";

import React from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { ProjectValidationResult } from "@/lib/project-validator";
import type {
  Collaborator,
  Organization,
  PermissionLevel,
} from "@/types/collaboration";
import type { LibraryItem } from "../types";
import { ShareProjectDialog } from "./ShareProjectDialog";
import { ProjectExportDialog } from "./ProjectExportDialog";
import { ValidationResultsDialog } from "./ValidationResultsDialog";
import {
  ExportDialog,
  ImportDialog,
} from "@/components/workflow-canvas/ImportExportDialog";

interface BuilderDialogsProps {
  selectedItem: LibraryItem | null;

  shareDialogOpen: boolean;
  onShareDialogChange: (open: boolean) => void;
  collaborators: Collaborator[];
  organizations: Organization[];
  onAddUser: (
    email: string,
    permission: PermissionLevel,
    expiresAt?: string
  ) => Promise<void>;
  onAddOrganization: (
    orgId: string,
    permission: PermissionLevel,
    expiresAt?: string
  ) => Promise<void>;
  onChangePermission: (
    collaboratorId: string,
    permission: PermissionLevel
  ) => Promise<void>;
  onRevoke: (collaboratorId: string) => Promise<void>;
  onGenerateLink: () => Promise<string>;

  exportDialogOpen: boolean;
  onExportDialogClose: () => void;

  importDialogOpen: boolean;
  onImportWorkflow: (workflow: Workflow) => void;
  onImportDialogClose: () => void;

  projectExportDialogOpen: boolean;
  onProjectExportDialogChange: (open: boolean) => void;

  validationDialogOpen: boolean;
  onValidationDialogChange: (open: boolean) => void;
  validationResults: ProjectValidationResult | null;
  onNavigateToWorkflow: (workflowId: string) => void;

  ConversionDialog: React.ComponentType;
}

export function BuilderDialogs({
  selectedItem,
  shareDialogOpen,
  onShareDialogChange,
  collaborators,
  organizations,
  onAddUser,
  onAddOrganization,
  onChangePermission,
  onRevoke,
  onGenerateLink,
  exportDialogOpen,
  onExportDialogClose,
  importDialogOpen,
  onImportWorkflow,
  onImportDialogClose,
  projectExportDialogOpen,
  onProjectExportDialogChange,
  validationDialogOpen,
  onValidationDialogChange,
  validationResults,
  onNavigateToWorkflow,
  ConversionDialog,
}: BuilderDialogsProps) {
  return (
    <>
      <ConversionDialog />

      {selectedItem && (
        <ShareProjectDialog
          open={shareDialogOpen}
          onOpenChange={onShareDialogChange}
          projectId={selectedItem.id}
          projectName={selectedItem.name}
          collaborators={collaborators}
          organizations={organizations}
          onAddUser={onAddUser}
          onAddOrganization={onAddOrganization}
          onChangePermission={onChangePermission}
          onRevoke={onRevoke}
          onGenerateLink={onGenerateLink}
        />
      )}

      {selectedItem && (
        <ExportDialog
          workflow={selectedItem}
          open={exportDialogOpen}
          onClose={onExportDialogClose}
        />
      )}

      <ImportDialog
        open={importDialogOpen}
        onImport={onImportWorkflow}
        onClose={onImportDialogClose}
      />

      <ProjectExportDialog
        open={projectExportDialogOpen}
        onOpenChange={onProjectExportDialogChange}
      />

      <ValidationResultsDialog
        open={validationDialogOpen}
        onOpenChange={onValidationDialogChange}
        results={validationResults}
        onNavigateToWorkflow={onNavigateToWorkflow}
      />
    </>
  );
}
