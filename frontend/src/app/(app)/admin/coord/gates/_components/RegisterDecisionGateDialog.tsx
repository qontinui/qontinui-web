"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  registerDecisionGate,
  type GateAudience,
} from "@/lib/api/operations/coordGates";
import { operationsErrorMessage } from "@/lib/api/operations/base";

interface RegisterDecisionGateDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Fired after a successful registration so the page can refresh the table. */
  onRegistered: () => void;
}

/**
 * "Register decision gate" — the coord-side entry for a decision the project
 * Overview shows (plan `2026-11-25-overview-timeline-and-milestones-derive-
 * from-coord`, Phase 8). The Overview is derived only from coord, so a decision
 * gate has to be enterable here, beside the gates it sits among.
 *
 * It only REGISTERS the gate: the decision itself is still entered with the
 * Approve / Reject / Reopen controls on the gate's row. Coord's own refusal
 * (an unknown work unit, another tenant's unit) is shown verbatim and nothing
 * is registered.
 */
export function RegisterDecisionGateDialog({
  open,
  onOpenChange,
  onRegistered,
}: RegisterDecisionGateDialogProps) {
  const [slug, setSlug] = useState("");
  const [phase, setPhase] = useState("");
  const [prompt, setPrompt] = useState("");
  const [audience, setAudience] = useState<GateAudience>("operator");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    slug.trim() !== "" && phase.trim() !== "" && prompt.trim() !== "";

  function handleOpenChange(o: boolean) {
    // A request in flight owns the dialog: closing mid-flight would drop its
    // outcome onto a closed form.
    if (!o && submitting) return;
    if (!o) {
      setError(null);
    }
    onOpenChange(o);
  }

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await registerDecisionGate({
        work_unit_slug: slug.trim(),
        phase_name: phase.trim(),
        prompt: prompt.trim(),
        clearance_audience: audience,
      });
      toast.success("Decision gate registered");
      setSlug("");
      setPhase("");
      setPrompt("");
      setAudience("operator");
      onRegistered();
      onOpenChange(false);
    } catch (e) {
      setError(operationsErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="gates-register-decision-dialog"
        data-ui-bridge-id="coord.gates-register-decision-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-5" />
            Register decision gate
          </DialogTitle>
          <DialogDescription>
            A gate that waits for a person&apos;s decision on one phase of a
            work unit. It appears in the project Overview as &ldquo;Waiting for
            a decision&rdquo;. Record the decision afterwards with Approve or
            Reject on the gate&apos;s row.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap break-words"
            data-testid="gates-register-decision-error"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="decision-gate-unit">Work unit (slug)</Label>
            <Input
              id="decision-gate-unit"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="2026-11-25-my-plan"
              data-testid="gates-register-decision-unit"
              data-ui-bridge-id="coord.gates-register-decision-unit"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="decision-gate-phase">Phase name</Label>
            <Input
              id="decision-gate-phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              placeholder="Customer showing accepted"
              data-testid="gates-register-decision-phase"
              data-ui-bridge-id="coord.gates-register-decision-phase"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="decision-gate-prompt">Title / question</Label>
            <Input
              id="decision-gate-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Has the customer accepted the showing?"
              data-testid="gates-register-decision-prompt"
              data-ui-bridge-id="coord.gates-register-decision-prompt"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="decision-gate-audience">Who decides</Label>
            <select
              id="decision-gate-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as GateAudience)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              data-testid="gates-register-decision-audience"
              data-ui-bridge-id="coord.gates-register-decision-audience"
            >
              <option value="operator">A person (operator)</option>
              <option value="agent">An agent may attest</option>
            </select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            data-ui-bridge-id="coord.gates-register-decision-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={submit}
            disabled={!canSubmit || submitting}
            data-testid="gates-register-decision-submit"
            data-ui-bridge-id="coord.gates-register-decision-submit"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Register gate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
