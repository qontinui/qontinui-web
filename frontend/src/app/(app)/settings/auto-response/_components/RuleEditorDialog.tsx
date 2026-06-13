"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { BackoffFields } from "./BackoffFields";
import { DEFAULT_BACKOFF } from "../types";
import type {
  AutoResponseRule,
  AutoResponseRuleCreate,
  AutoResponseRuleUpdate,
  BackoffConfig,
} from "../types";

interface RuleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this rule; otherwise it creates a new one. */
  rule: AutoResponseRule | null;
  saving: boolean;
  onCreate: (data: AutoResponseRuleCreate) => Promise<boolean>;
  onUpdate: (id: string, data: AutoResponseRuleUpdate) => Promise<boolean>;
}

function regexError(pattern: string): string | null {
  if (!pattern) return null;
  try {
    // Constructing validates the pattern; throws on invalid syntax.
    void new RegExp(pattern);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid regular expression";
  }
}

export function RuleEditorDialog({
  open,
  onOpenChange,
  rule,
  saving,
  onCreate,
  onUpdate,
}: RuleEditorDialogProps) {
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [prompt, setPrompt] = useState("");
  const [backoff, setBackoff] = useState<BackoffConfig>(DEFAULT_BACKOFF);

  // Reset form whenever the dialog opens (for the active rule, or blank).
  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setPattern(rule.pattern);
      setPrompt(rule.prompt);
      setBackoff(rule.backoff);
    } else {
      setName("");
      setPattern("");
      setPrompt("");
      setBackoff(DEFAULT_BACKOFF);
    }
  }, [open, rule]);

  const patternError = useMemo(() => regexError(pattern), [pattern]);

  const canSubmit =
    name.trim().length > 0 &&
    pattern.trim().length > 0 &&
    prompt.trim().length > 0 &&
    patternError === null &&
    !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    let ok: boolean;
    if (rule) {
      ok = await onUpdate(rule.id, {
        name,
        pattern,
        prompt,
        backoff,
      });
    } else {
      ok = await onCreate({
        name,
        pattern,
        prompt,
        backoff,
      });
    }
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit Rule" : "New Rule"}</DialogTitle>
          <DialogDescription>
            Auto-respond to matching agent output with a follow-up prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Continue on permission prompt"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-pattern">Pattern (regex)</Label>
            <Input
              id="rule-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. Do you want to proceed\?"
              aria-invalid={patternError !== null}
              className={
                patternError !== null
                  ? "border-destructive focus-visible:ring-destructive"
                  : undefined
              }
            />
            {patternError !== null && (
              <p className="text-xs text-destructive">
                Invalid regex: {patternError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-prompt">Prompt</Label>
            <Textarea
              id="rule-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="The response to send when the pattern matches"
            />
          </div>

          <BackoffFields value={backoff} onChange={setBackoff} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {rule ? "Save Changes" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
