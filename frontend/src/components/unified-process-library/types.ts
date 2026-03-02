import type { Workflow } from "@/lib/action-schema/action-types";

// LibraryItem is now just Workflow - sequential workflows are linear graphs
export type LibraryItem = Workflow;

export interface UnifiedProcessLibraryProps {
  selectedItem: LibraryItem | null;
  onSelectItem: (item: LibraryItem) => void;
  onDeleteItem: (item: LibraryItem) => void;
  onDeleteItems?: (items: LibraryItem[]) => void;
  onUpdateWorkflow?: (workflow: Workflow) => void;
  onCreateSequential?: (category: string) => void;
  onCreateGraph?: (category: string) => void;
  onConvertItem?: (item: LibraryItem) => void;
}
