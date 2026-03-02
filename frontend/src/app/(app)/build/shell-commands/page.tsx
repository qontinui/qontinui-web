"use client";

import { useState } from "react";
import { Terminal, Workflow } from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  useShellCommandsList,
  useCreateShellCommand,
  useUpdateShellCommand,
  useDeleteShellCommand,
} from "@/hooks/useLibrary";
import { Button } from "@/components/ui/button";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { ShellCommandItem, ShellCommandCreate } from "@/services/library-service";
import type { UnifiedStep } from "@/types/unified-workflow";
import {
  type ShellCommandForm,
  toForm,
  defaultForm,
  toPayload,
} from "./shell-command-utils";
import { ShellCommandListItem } from "./_components/ShellCommandListItem";
import { ShellCommandEditor } from "./_components/ShellCommandEditor";

export default function ShellCommandsPage() {
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);
  const listQuery = useShellCommandsList();
  const createMutation = useCreateShellCommand();
  const updateMutation = useUpdateShellCommand();
  const deleteMutation = useDeleteShellCommand();

  const builder = useBuilderPage<ShellCommandItem, ShellCommandForm, ShellCommandCreate>({
    items: listQuery.data,
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    isOffline: false,
    toForm,
    defaultForm,
    toPayload,
    onCreate: (data) => createMutation.mutateAsync(data),
    onUpdate: (id, data) => updateMutation.mutateAsync({ id, data }),
    onDelete: (id) => deleteMutation.mutateAsync(id),
    refetch: () => listQuery.refetch(),
  });

  return (
    <>
      <BuilderLayout<ShellCommandItem>
        title="Shell Commands"
        icon={Terminal}
        iconColor="text-orange-400"
        accentColor="orange"
        items={builder.items}
        isLoading={builder.isLoading}
        error={builder.error}
        isOffline={builder.isOffline}
        selectedItem={builder.selectedItem}
        onSelect={builder.onSelect}
        onNew={builder.onNew}
        onDelete={builder.onDelete}
        refetch={builder.refetch}
        emptyIcon={Terminal}
        emptyTitle="No shell commands yet"
        emptyDescription="Create reusable shell commands for automation"
        itemLabel="command"
        searchPlaceholder="Search commands..."
        initialSelectedId={builder.initialSelectedId}
        renderListItem={(item, isSelected) => (
          <ShellCommandListItem item={item} isSelected={isSelected} />
        )}
        renderListActions={(item) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
            title="Insert into Workflow"
            onClick={() => {
              setAddToWorkflowStep({
                type: "command",
                name: item.name,
                command: item.command,
                shell_command_id: item.id,
                working_directory: item.working_directory ?? undefined,
              });
            }}
          >
            <Workflow className="size-3.5" />
          </Button>
        )}
        renderEditor={(item) => (
          <ShellCommandEditor
            item={item}
            form={builder.form}
            setForm={builder.setForm}
            isDirty={builder.isDirty}
            isNew={builder.isNew}
            isSaving={builder.isSaving}
            onSave={builder.save}
            onDelete={builder.deleteSelected}
          />
        )}
      />
      <AddToWorkflowDialog
        open={addToWorkflowStep !== null}
        onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
        stepData={addToWorkflowStep ?? {}}
      />
    </>
  );
}
