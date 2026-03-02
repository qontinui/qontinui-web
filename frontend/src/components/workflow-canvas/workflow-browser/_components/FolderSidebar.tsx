import React from "react";
import { Workflow } from "../../../../lib/action-schema/action-types";
import { workflowFolderManager } from "../../../../services/workflow-folder-manager";
import { FolderTree } from "../../../workflow-organization/FolderTree";
import type { WorkflowFolder } from "../../../workflow-organization/types";

interface FolderSidebarProps {
  folders: WorkflowFolder[];
  workflows: Workflow[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onReload: () => void;
}

export function FolderSidebar({
  folders,
  workflows,
  selectedFolderId,
  onSelectFolder,
  onReload,
}: FolderSidebarProps) {
  return (
    <div className="w-80 border-r flex flex-col">
      <FolderTree
        folders={folders}
        workflows={workflows}
        selectedFolderId={selectedFolderId}
        onSelectFolder={onSelectFolder}
        onCreateFolder={(name, parentId) => {
          workflowFolderManager.createFolder({
            name,
            parentId: parentId || null,
          });
          onReload();
        }}
        onUpdateFolder={(id, updates) => {
          workflowFolderManager.updateFolder(id, updates);
          onReload();
        }}
        onDeleteFolder={(id) => {
          workflowFolderManager.deleteFolder(id);
          onReload();
        }}
        onMoveFolder={(folderId, newParentId) => {
          workflowFolderManager.moveFolder(folderId, newParentId);
          onReload();
        }}
        onMoveWorkflow={(workflowId, folderId) => {
          if (folderId) {
            workflowFolderManager.addWorkflowToFolder(workflowId, folderId);
          } else {
            workflowFolderManager.removeWorkflowFromFolder(workflowId);
          }
          onReload();
        }}
      />
    </div>
  );
}
