"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Server } from "lucide-react";
import { DispatchWorkflowDialog } from "./DispatchWorkflowDialog";

interface DispatchWorkflowButtonProps {
  workflowId: string;
  workflowName?: string;
  disabled?: boolean;
  /** Optional custom label — defaults to "Run on server". */
  label?: string;
  /** Optional route template. Token {execution_id} is replaced. */
  executionRouteTemplate?: string;
  className?: string;
}

/**
 * Button + dialog for dispatching a workflow to a server-mode runner.
 *
 * Intended to sit alongside existing Run/Edit controls on the workflow
 * detail page.
 */
export function DispatchWorkflowButton({
  workflowId,
  workflowName,
  disabled,
  label = "Run on server",
  executionRouteTemplate,
  className,
}: DispatchWorkflowButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={className}
        aria-label={`${label} — dispatch workflow to a server-mode runner`}
      >
        <Server className="w-3.5 h-3.5 mr-1.5" />
        {label}
      </Button>
      <DispatchWorkflowDialog
        open={open}
        onOpenChange={setOpen}
        workflowId={workflowId}
        workflowName={workflowName}
        executionRouteTemplate={executionRouteTemplate}
      />
    </>
  );
}
