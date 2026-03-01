"use client";

import { useState, useMemo, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Layers,
  Workflow,
} from "lucide-react";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import {
  useChecksList,
  useCreateCheck,
  useUpdateCheck,
  useDeleteCheck,
  useCheckGroupsList,
  useCreateCheckGroup,
  useUpdateCheckGroup,
  useDeleteCheckGroup,
} from "@/hooks/useLibrary";
import { Button } from "@/components/ui/button";
import type { CheckItem, CheckCreate, CheckGroupItem, CheckGroupCreate } from "@/services/library-service";
import { AddToWorkflowDialog } from "@/components/builders/AddToWorkflowDialog";
import type { UnifiedStep } from "@/types/unified-workflow";
import { getCheckDefaults } from "./constants";
import {
  type CheckForm,
  type CheckGroupForm,
  type SuggestedCheck,
  type TabId,
  toCheckForm,
  defaultCheckForm,
  toCheckPayload,
  toGroupForm,
  defaultGroupForm,
  toGroupPayload,
} from "./check-utils";
import { TabButton } from "./_components/TabButton";
import { CheckCreationDialog } from "./_components/CheckCreationDialog";
import { CheckListItem } from "./_components/CheckListItem";
import { CheckEditor } from "./_components/CheckEditor";
import { CheckGroupListItem } from "./_components/CheckGroupListItem";
import { CheckGroupEditor } from "./_components/CheckGroupEditor";

function ChecksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(
    searchParams.get("tab") === "groups" ? "groups" : "checks"
  );
  const [showCreationDialog, setShowCreationDialog] = useState(false);
  const [addToWorkflowStep, setAddToWorkflowStep] = useState<Partial<UnifiedStep> | null>(null);

  // --- Checks hooks (always called) ---
  const checksListQuery = useChecksList();
  const createCheckMutation = useCreateCheck();
  const updateCheckMutation = useUpdateCheck();
  const deleteCheckMutation = useDeleteCheck();

  const checksBuilder = useBuilderPage<CheckItem, CheckForm, CheckCreate>({
    items: checksListQuery.data,
    isLoading: checksListQuery.isLoading,
    error: checksListQuery.error,
    isOffline: false,
    toForm: toCheckForm,
    defaultForm: defaultCheckForm,
    toPayload: toCheckPayload,
    onCreate: (data) => createCheckMutation.mutateAsync(data),
    onUpdate: (id, data) => updateCheckMutation.mutateAsync({ id, data }),
    onDelete: (id) => deleteCheckMutation.mutateAsync(id),
    refetch: () => checksListQuery.refetch(),
  });

  // --- Check Groups hooks (always called) ---
  const groupsListQuery = useCheckGroupsList();
  const createGroupMutation = useCreateCheckGroup();
  const updateGroupMutation = useUpdateCheckGroup();
  const deleteGroupMutation = useDeleteCheckGroup();

  const groupsBuilder = useBuilderPage<CheckGroupItem, CheckGroupForm, CheckGroupCreate>({
    items: groupsListQuery.data,
    isLoading: groupsListQuery.isLoading,
    error: groupsListQuery.error,
    isOffline: false,
    toForm: toGroupForm,
    defaultForm: defaultGroupForm,
    toPayload: toGroupPayload,
    onCreate: (data) => createGroupMutation.mutateAsync(data),
    onUpdate: (id, data) => updateGroupMutation.mutateAsync({ id, data }),
    onDelete: (id) => deleteGroupMutation.mutateAsync(id),
    refetch: () => groupsListQuery.refetch(),
  });

  const checksMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; description?: string | null; check_type: string }>();
    (checksListQuery.data || []).forEach((check) => map.set(check.id, check));
    return map;
  }, [checksListQuery.data]);

  // --- Tab switching ---
  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      const url = tab === "groups" ? "/build/checks?tab=groups" : "/build/checks";
      router.replace(url);
    },
    [router]
  );

  // --- Check creation dialog handler ---
  const handleCreationDialogCreate = (checkType: string, tool: string) => {
    const defaults = getCheckDefaults(checkType, tool);
    checksBuilder.onNew();
    checksBuilder.setForm((prev) => ({
      ...prev,
      name: defaults.name,
      check_type: checkType,
      tool,
      command: defaults.command,
      description: defaults.description,
      auto_fix: defaults.auto_fix,
    }));
  };

  const handleAcceptAiChecks = async (checks: SuggestedCheck[]) => {
    for (const check of checks) {
      try {
        await createCheckMutation.mutateAsync({
          name: check.name,
          check_type: check.check_type,
          tool: check.tool,
          command: check.command,
          description: check.description || null,
          auto_fix: false,
          fail_on_warning: false,
          is_critical: false,
          timeout_seconds: 300,
          enabled: true,
          tags: ["ai-generated"],
        } as Parameters<typeof createCheckMutation.mutateAsync>[0]);
      } catch {
        // Continue creating the rest even if one fails
      }
    }
    await checksListQuery.refetch();
  };

  // --- Check Groups list actions ---
  const renderGroupListActions = useCallback(
    (item: CheckGroupItem) => (
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-blue-400"
        title="Insert into Workflow"
        onClick={() => {
          setAddToWorkflowStep({
            type: "command",
            name: item.name,
            check_group_id: item.id,
          });
        }}
      >
        <Workflow className="size-3.5" />
      </Button>
    ),
    []
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0">
        <TabButton
          active={activeTab === "checks"}
          onClick={() => handleTabChange("checks")}
          icon={CheckCircle2}
          label="Checks"
          count={checksListQuery.data?.length}
        />
        <TabButton
          active={activeTab === "groups"}
          onClick={() => handleTabChange("groups")}
          icon={Layers}
          label="Check Groups"
          count={groupsListQuery.data?.length}
        />
      </div>

      {/* Active panel */}
      {activeTab === "checks" ? (
        <>
          <BuilderLayout<CheckItem>
            title="Checks"
            icon={CheckCircle2}
            iconColor="text-green-400"
            accentColor="green"
            items={checksBuilder.items}
            isLoading={checksBuilder.isLoading}
            error={checksBuilder.error}
            isOffline={checksBuilder.isOffline}
            selectedItem={checksBuilder.selectedItem}
            onSelect={checksBuilder.onSelect}
            onNew={() => setShowCreationDialog(true)}
            onDelete={checksBuilder.onDelete}
            refetch={checksBuilder.refetch}
            emptyIcon={CheckCircle2}
            emptyTitle="No checks yet"
            emptyDescription="Create verification checks for linting, formatting, and more"
            itemLabel="check"
            searchPlaceholder="Search checks..."
            initialSelectedId={checksBuilder.initialSelectedId}
            renderListItem={(item, isSelected) => (
              <CheckListItem item={item} isSelected={isSelected} />
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
                    check_type: item.check_type as import("@/types/unified-workflow").CheckType,
                    check_id: item.id,
                    command: item.command ?? undefined,
                  });
                }}
              >
                <Workflow className="size-3.5" />
              </Button>
            )}
            renderEditor={(item) => (
              <CheckEditor
                item={item}
                form={checksBuilder.form}
                setForm={checksBuilder.setForm}
                isDirty={checksBuilder.isDirty}
                isNew={checksBuilder.isNew}
                isSaving={checksBuilder.isSaving}
                onSave={checksBuilder.save}
                onDelete={checksBuilder.deleteSelected}
                onAcceptAiChecks={handleAcceptAiChecks}
              />
            )}
          />

          <CheckCreationDialog
            open={showCreationDialog}
            onOpenChange={setShowCreationDialog}
            onCreateCheck={handleCreationDialogCreate}
          />
        </>
      ) : (
        <BuilderLayout<CheckGroupItem>
          title="Check Groups"
          icon={Layers}
          iconColor="text-teal-400"
          accentColor="teal"
          items={groupsBuilder.items}
          isLoading={groupsBuilder.isLoading}
          error={groupsBuilder.error}
          isOffline={groupsBuilder.isOffline}
          selectedItem={groupsBuilder.selectedItem}
          onSelect={groupsBuilder.onSelect}
          onNew={groupsBuilder.onNew}
          onDelete={groupsBuilder.onDelete}
          refetch={groupsBuilder.refetch}
          emptyIcon={Layers}
          emptyTitle="No check groups yet"
          emptyDescription="Create organized collections of checks"
          itemLabel="check group"
          searchPlaceholder="Search check groups..."
          initialSelectedId={groupsBuilder.initialSelectedId}
          renderListItem={(item, isSelected) => (
            <CheckGroupListItem item={item} isSelected={isSelected} />
          )}
          renderListActions={renderGroupListActions}
          renderEditor={(item) => (
            <CheckGroupEditor
              item={item}
              form={groupsBuilder.form}
              setForm={groupsBuilder.setForm}
              isDirty={groupsBuilder.isDirty}
              isNew={groupsBuilder.isNew}
              isSaving={groupsBuilder.isSaving}
              onSave={groupsBuilder.save}
              onDelete={groupsBuilder.deleteSelected}
              checksMap={checksMap}
            />
          )}
        />
      )}

      <AddToWorkflowDialog
        open={addToWorkflowStep !== null}
        onOpenChange={(open) => !open && setAddToWorkflowStep(null)}
        stepData={addToWorkflowStep ?? {}}
      />
    </div>
  );
}

export default function ChecksPage() {
  return (
    <Suspense fallback={null}>
      <ChecksPageContent />
    </Suspense>
  );
}
