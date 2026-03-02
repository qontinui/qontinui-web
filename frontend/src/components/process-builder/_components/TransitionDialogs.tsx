"use client";

import { OutgoingTransitionBuilder } from "@/components/outgoing-transition-builder";
import { IncomingTransitionBuilder } from "@/components/incoming-transition-builder";
import { FormatConversionDialog } from "@/components/format-conversion-dialog";
import type { Workflow } from "@/lib/action-schema/action-types";

interface TransitionDialogsProps {
  showTransitionDialog: boolean;
  transitionType: "incoming" | "outgoing" | null;
  preselectedWorkflowId: string | undefined;
  conversionDialogOpen: boolean;
  conversionItem: Workflow | null;
  onCloseTransitionDialog: () => void;
  onConversionDialogOpenChange: (open: boolean) => void;
  onConversionComplete: (converted: Workflow) => void;
}

export function TransitionDialogs({
  showTransitionDialog,
  transitionType,
  preselectedWorkflowId,
  conversionDialogOpen,
  conversionItem,
  onCloseTransitionDialog,
  onConversionDialogOpenChange,
  onConversionComplete,
}: TransitionDialogsProps) {
  return (
    <>
      {showTransitionDialog && transitionType === "outgoing" && (
        <OutgoingTransitionBuilder
          preselectedWorkflow={preselectedWorkflowId}
          onClose={onCloseTransitionDialog}
        />
      )}
      {showTransitionDialog && transitionType === "incoming" && (
        <IncomingTransitionBuilder
          preselectedWorkflow={preselectedWorkflowId}
          onClose={onCloseTransitionDialog}
        />
      )}

      <FormatConversionDialog
        open={conversionDialogOpen}
        onOpenChange={onConversionDialogOpenChange}
        item={conversionItem}
        onConvert={onConversionComplete}
      />
    </>
  );
}
