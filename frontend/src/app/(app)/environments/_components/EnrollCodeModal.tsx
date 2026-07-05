"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, ShieldAlert, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiConfig } from "@/services/api-config";
import type { MachineCreated } from "@/services/devenv-api";

interface EnrollCodeModalProps {
  /** The created/regenerated machine carrying the one-time code. */
  machine: MachineCreated | null;
  /** Called when the modal is dismissed. */
  onClose: () => void;
}

/**
 * Resolve the absolute web-backend base URL the on-box `env enroll` command
 * should POST to. `ApiConfig.API_BASE_URL` is set on remote deployments (e.g.
 * `https://qontinui.io`); when empty (same-origin dev), fall back to the
 * dashboard's own origin so the copied command carries an absolute URL the
 * target machine can actually reach.
 */
function resolveBackendBase(): string {
  if (ApiConfig.API_BASE_URL) return ApiConfig.API_BASE_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "https://qontinui.io";
}

/**
 * Renders a machine's one-time enrollment code plus a copy-paste command to
 * run on the target machine — no build-from-source, no guesswork. The code is
 * a one-time credential (never retrievable again); dismissing the modal
 * discards it from the UI.
 */
export function EnrollCodeModal({ machine, onClose }: EnrollCodeModalProps) {
  const [copied, setCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  // Two lines: `env enroll` binds this machine to the environment via the
  // one-time code; `env capture` pushes its first (secret-free) config snapshot
  // so the drift view populates without a second manual step.
  //
  // The installed runner binary itself handles the `env` subcommands (a pre-GUI
  // CLI mode — qontinui-runner Phase 1a), so this references `qontinui-runner`,
  // which is present on every paired box — no separate `qontinui_profile` build.
  const enrollCommand = machine
    ? `qontinui-runner env enroll --code ${machine.enrollment_code} --backend ${resolveBackendBase()}\nqontinui-runner env capture`
    : "";

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

  const handleCopyCommand = async () => {
    if (!machine) return;
    try {
      await navigator.clipboard.writeText(enrollCommand);
      setCommandCopied(true);
      toast.success("Command copied");
      window.setTimeout(() => setCommandCopied(false), 2_000);
    } catch {
      toast.error("Failed to copy — copy it manually");
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCopied(false);
      setCommandCopied(false);
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
            Copy the one-time code, then run the command below on the machine
            you&apos;re enrolling.
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

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Terminal className="size-4" />
              Run this on the target machine
            </div>
            <div className="flex items-start gap-2">
              <pre className="flex-1 overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed select-all whitespace-pre">
                {enrollCommand}
              </pre>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCommand}
                aria-label="Copy enroll command"
              >
                {commandCopied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {commandCopied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste into a terminal on the machine you&apos;re enrolling. The
              first line binds it to this environment; the second pushes its
              first secret-free config snapshot so the drift view populates.
            </p>
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
