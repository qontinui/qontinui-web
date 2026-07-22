"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  FileInput,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useClauses } from "../_hooks/useClauses";
import { ClauseEditorDialog } from "./ClauseEditorDialog";
import { ClauseImportDialog } from "./ClauseImportDialog";
import {
  CLAUSE_STATUS_VARIANT,
  CLAUSE_TIERS,
  TIER_INHERIT,
  type Clause,
  type ClauseTier,
  type PromptDocument,
} from "../types";
import { lintClause } from "../_lib/clauseLint";

interface ClauseManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The policy document whose clauses are managed. `null` while it loads. */
  document: PromptDocument | null;
  loadingBody: boolean;
  /** Refresh the parent document list after a category default-tier edit. */
  onDocsReload: () => void;
}

/**
 * The structured-clause manager for a `policy` prompt document: the ordered
 * clause list (status/tier badges + reorder), the clause editor, the YAML
 * candidate importer, and the category default-tier editor. All clause CRUD goes
 * through the coord clause-route proxy via `useClauses`.
 */
export function ClauseManagerDialog({
  open,
  onOpenChange,
  document,
  loadingBody,
  onDocsReload,
}: ClauseManagerDialogProps) {
  const name = document?.name ?? "";
  const {
    clauses,
    loading,
    saving,
    error,
    createClause,
    updateClause,
    deleteClause,
    reorderClauses,
    importCandidates,
    saveAttrs,
  } = useClauses("policy", name, open && document !== null, onDocsReload);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Clause | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Clause | null>(null);

  const [defaultTier, setDefaultTier] = useState<ClauseTier | null>(null);
  useEffect(() => {
    setDefaultTier(document?.attrs?.default_tier ?? null);
  }, [document]);

  const tierDirty = (document?.attrs?.default_tier ?? null) !== defaultTier;

  const existingIds = clauses.map((c) => c.clause_id);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (c: Clause) => {
    setEditing(c);
    setEditorOpen(true);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= clauses.length) return;
    const ids = clauses.map((c) => c.clause_id);
    const moved = ids.splice(index, 1)[0]!;
    ids.splice(target, 0, moved);
    void reorderClauses(ids);
  };

  const saveTier = async () => {
    const attrs = {
      ...(document?.attrs ?? {}),
      default_tier: defaultTier,
    };
    await saveAttrs(attrs);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[90vh] max-w-3xl overflow-y-auto"
          data-testid="clause-manager"
        >
          <DialogHeader>
            <DialogTitle>Clauses — {document?.description ?? name}</DialogTitle>
            <DialogDescription>
              The structured clauses of <code>{`{{policy:${name}}}`}</code>,
              ordered as coord serves them. Edits are tenant-scoped and
              validated by coord.
            </DialogDescription>
          </DialogHeader>

          {loadingBody || !document ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading document…
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Category header editor — the per-category default tier. */}
              <div className="flex items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="category-default-tier">
                    Category default tier
                  </Label>
                  <Select
                    value={defaultTier ?? TIER_INHERIT}
                    onValueChange={(v) =>
                      setDefaultTier(
                        v === TIER_INHERIT ? null : (v as ClauseTier)
                      )
                    }
                  >
                    <SelectTrigger
                      id="category-default-tier"
                      className="w-52"
                      data-testid="category-default-tier"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TIER_INHERIT}>None</SelectItem>
                      {CLAUSE_TIERS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="flex-1 text-xs text-muted-foreground">
                  Clauses with no tier of their own inherit this. Written to the
                  document&apos;s <code>attrs.default_tier</code>.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveTier}
                  disabled={saving || !tierDirty}
                  data-testid="category-default-tier-save"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Save
                </Button>
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {clauses.length} clause{clauses.length === 1 ? "" : "s"}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setImportOpen(true)}
                    data-testid="clause-import-open"
                  >
                    <FileInput className="size-4" />
                    Import YAML
                  </Button>
                  <Button
                    size="sm"
                    onClick={openCreate}
                    data-testid="clause-new"
                  >
                    <Plus className="size-4" />
                    New clause
                  </Button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Couldn&apos;t load clauses: {error}
                  </p>
                </div>
              )}

              {loading && clauses.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Loading clauses…
                </div>
              ) : clauses.length === 0 && !error ? (
                <div className="rounded-lg border border-dashed border-border py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    No clauses yet. Add one, or import a{" "}
                    <code>POLICY_CANDIDATES</code> block.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {clauses.map((c, i) => (
                    <ClauseRow
                      key={c.clause_id}
                      clause={c}
                      index={i}
                      count={clauses.length}
                      saving={saving}
                      onEdit={() => openEdit(c)}
                      onDelete={() => setDeleteTarget(c)}
                      onMove={(dir) => move(i, dir)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ClauseEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        clause={editing}
        category={name}
        defaultTier={defaultTier}
        existingClauseIds={existingIds}
        saving={saving}
        onCreate={createClause}
        onUpdate={updateClause}
      />

      <ClauseImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        category={name}
        saving={saving}
        onImport={importCandidates}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete clause?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes{" "}
              <span className="font-medium">{deleteTarget?.clause_id}</span>.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void deleteClause(deleteTarget.clause_id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ClauseRowProps {
  clause: Clause;
  index: number;
  count: number;
  saving: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}

function ClauseRow({
  clause,
  index,
  count,
  saving,
  onEdit,
  onDelete,
  onMove,
}: ClauseRowProps) {
  const lintCount = lintClause({
    action: clause.action,
    escalate_if: clause.escalate_if,
    bounds: clause.bounds,
  }).length;

  return (
    <div
      className="group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3"
      data-testid={`clause-row-${clause.clause_id}`}
    >
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => onMove(-1)}
          disabled={saving || index === 0}
          title="Move up"
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => onMove(1)}
          disabled={saving || index === count - 1}
          title="Move down"
        >
          <ArrowDown className="size-3.5" />
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-sm font-medium">{clause.clause_id}</code>
          <Badge variant={CLAUSE_STATUS_VARIANT[clause.status]}>
            {clause.status}
          </Badge>
          <Badge variant="outline">{clause.tier ?? "inherit"}</Badge>
          {lintCount > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
              title="Authoring-lint warnings — open to review"
            >
              <AlertTriangle className="size-3" />
              {lintCount}
            </span>
          )}
        </div>
        {clause.trigger && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {clause.trigger}
          </p>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0"
        onClick={onEdit}
        title="Edit clause"
      >
        <Pencil className="size-4" />
      </Button>
      <DestructiveButton
        size="sm"
        className="h-8 w-8 shrink-0 p-0"
        onClick={onDelete}
        title="Delete clause"
      >
        <Trash2 className="size-4" />
      </DestructiveButton>
    </div>
  );
}
