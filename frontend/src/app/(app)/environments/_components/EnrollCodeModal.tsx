"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MachineCreated } from "@/services/devenv-api";

interface EnrollCodeModalProps {
  /** The created/regenerated machine carrying the one-time code. */
  machine: MachineCreated | null;
  /** Called when the modal is dismissed. */
  onClose: () => void;
}

/**
 * Renders a machine's one-time enrollment code with a copy button and a
 * prominent "shown once" warning. The code is never retrievable again —
 * dismissing the modal discards it from the UI.
 */
export function EnrollCodeModal({ machine, onClose }: EnrollCodeModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!machine) return;
    try {
      await navigator.clipboard.writeText(machine.enrollment_code);
      setCopied(true);
      toast.success("Enrollment code copied");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Failed to copy — copy it manually");
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCopied(false);
      onClose();
    }
  };

  const expiresAt = machine
    ? new Date(machine.enrollment_expires_at).toLocaleString()
    : null;

  return (
    <Dialog open={machine !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Enrollment code for {machine?.name}
          </DialogTitle>
          <DialogDescription>
            Use this one-time code to enroll the agent on this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
            <ShieldAlert className="size-4 shrink-0 text-warning mt-0.5" />
            <p className="text-xs text-foreground">
              This code is shown <span className="font-semibold">only once</span>{" "}
              and cannot be retrieved later. Copy it now and store it securely.
              {expiresAt && (
                <>
                  {" "}
                  It expires{" "}
                  <span className="font-medium">{expiresAt}</span>.
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm break-all select-all">
              {machine?.enrollment_code}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              aria-label="Copy enrollment code"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="brand-primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
