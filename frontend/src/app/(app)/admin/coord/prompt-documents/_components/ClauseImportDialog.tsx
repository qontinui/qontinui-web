"use client";

import { useMemo, useState } from "react";
import { parse as parseYaml } from "yaml";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ClauseCreate } from "../types";
import { parsePolicyCandidatesYaml } from "../_lib/clauseLint";

interface ClauseImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The policy document name — stamped as each imported clause's `category`. */
  category: string;
  saving: boolean;
  /** Bulk-insert the parsed candidates (each as status `proposed`). */
  onImport: (candidates: ClauseCreate[]) => Promise<number>;
}

/**
 * Paste a `POLICY_CANDIDATES` YAML block → parse client-side into draft clauses
 * → insert them all as `proposed`. The parse is entirely local (the `yaml` dep);
 * only the resulting clauses hit coord via the create route, so coord still
 * validates each one.
 */
export function ClauseImportDialog({
  open,
  onOpenChange,
  category,
  saving,
  onImport,
}: ClauseImportDialogProps) {
  const [text, setText] = useState("");

  const { candidates, parseError } = useMemo((): {
    candidates: ClauseCreate[];
    parseError: string | null;
  } => {
    if (text.trim().length === 0) return { candidates: [], parseError: null };
    try {
      const parsed = parseYaml(text);
      const list = parsePolicyCandidatesYaml(text, parsed, category);
      if (list.length === 0) {
        return { candidates: [], parseError: "No clauses found in the YAML." };
      }
      return { candidates: list, parseError: null };
    } catch (err) {
      return {
        candidates: [],
        parseError: err instanceof Error ? err.message : "Invalid YAML.",
      };
    }
  }, [text, category]);

  const handleImport = async () => {
    if (candidates.length === 0) return;
    const created = await onImport(candidates);
    if (created > 0) {
      setText("");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        data-testid="clause-import"
      >
        <DialogHeader>
          <DialogTitle>Import YAML candidates</DialogTitle>
          <DialogDescription>
            Paste a <code>POLICY_CANDIDATES</code> YAML block. Each entry is
            parsed into a clause and inserted into <code>{category}</code> with
            status <span className="font-medium">proposed</span> for review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label htmlFor="clause-import-yaml">YAML</Label>
            <Textarea
              id="clause-import-yaml"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={16}
              className="font-mono text-xs"
              placeholder={
                "POLICY_CANDIDATES:\n  - clause_id: reads-are-free\n    tier: proceed\n    trigger: A read-only action is reachable in-session\n    action: Execute and report\n    bounds: Read-only credentials only\n    escalate_if:\n      - the read requires a write-scoped credential"
              }
              data-testid="clause-import-yaml"
            />
          </div>

          {parseError && (
            <p
              className="flex items-start gap-1 text-xs text-destructive"
              data-testid="clause-import-error"
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {parseError}
            </p>
          )}
          {candidates.length > 0 && !parseError && (
            <p className="text-xs text-muted-foreground">
              {candidates.length} clause{candidates.length === 1 ? "" : "s"}{" "}
              ready to import:{" "}
              <span className="font-mono">
                {candidates.map((c) => c.clause_id).join(", ")}
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={saving || candidates.length === 0}
            data-testid="clause-import-submit"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Import {candidates.length > 0 ? candidates.length : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
