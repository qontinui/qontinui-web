"use client";

/**
 * Design Policies — tenant-scoped, user-authored UX/design policies.
 *
 * The editable half of /admin/coord/policies. These records are the
 * tool-agnostic source of truth read by AI agents over
 * GET /api/v1/design-policies. Built-ins seed on first load and can be
 * edited or disabled but not deleted.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { BookOpen, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  useDesignPolicies,
  type DesignPolicy,
  type Severity,
} from "../_hooks/useDesignPolicies";

const SEVERITIES: Severity[] = ["info", "warning", "error"];

/** Severity as a semantic Badge — color is never the sole signal (text shown). */
function severityBadge(severity: Severity) {
  const variant =
    severity === "error"
      ? "destructive"
      : severity === "warning"
        ? "outline"
        : "secondary";
  return (
    <Badge variant={variant} data-testid={`severity-${severity}`}>
      {severity}
    </Badge>
  );
}

interface FormState {
  slug: string;
  name: string;
  principle: string;
  rationale: string;
  enforcement: string;
  category: string;
  severity: Severity;
  applies_to: string;
  sort_order: number;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  slug: "",
  name: "",
  principle: "",
  rationale: "",
  enforcement: "",
  category: "",
  severity: "info",
  applies_to: "",
  sort_order: 0,
  enabled: true,
};

function toForm(p: DesignPolicy): FormState {
  return {
    slug: p.slug,
    name: p.name,
    principle: p.principle,
    rationale: p.rationale,
    enforcement: p.enforcement,
    category: p.category,
    severity: p.severity,
    applies_to: p.applies_to,
    sort_order: p.sort_order,
    enabled: p.enabled,
  };
}

export function DesignPoliciesSection() {
  const { policies, loading, saving, create, update, remove, reset } =
    useDesignPolicies();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DesignPolicy | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<DesignPolicy | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (p: DesignPolicy) => {
    setEditing(p);
    setForm(toForm(p));
    setEditorOpen(true);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const ok = editing
      ? await update(editing.id, {
          name: form.name,
          principle: form.principle,
          rationale: form.rationale,
          enforcement: form.enforcement,
          category: form.category,
          severity: form.severity,
          applies_to: form.applies_to,
          sort_order: form.sort_order,
          enabled: form.enabled,
        })
      : await create(form);
    if (ok) setEditorOpen(false);
  };

  const canSubmit = form.name.trim() !== "" && form.slug.trim() !== "";

  return (
    <Card data-testid="design-policies-section">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            Design Policies
            {!loading && (
              <Badge variant="outline" className="ml-1">
                {policies.length}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            User-defined UX policies agents read from the database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetOpen(true)}
            disabled={saving}
            data-testid="design-policies-reset"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={openCreate}
            disabled={saving}
            data-testid="design-policies-new"
          >
            <Plus className="h-3 w-3 mr-1" />
            New policy
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : policies.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="design-policies-empty"
          >
            No design policies yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p) => (
                <TableRow key={p.id} data-testid={`design-policy-${p.slug}`}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-2">
                      {p.name}
                      {p.is_built_in && (
                        <Badge variant="secondary" className="text-[10px]">
                          built-in
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {p.principle}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.category || "—"}
                  </TableCell>
                  <TableCell>{severityBadge(p.severity)}</TableCell>
                  <TableCell>
                    {p.enabled ? (
                      <Badge variant="secondary">enabled</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        disabled
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(p)}
                        data-testid={`design-policy-edit-${p.slug}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(p)}
                        disabled={p.is_built_in}
                        title={
                          p.is_built_in
                            ? "Built-in policies can be disabled but not deleted"
                            : "Delete policy"
                        }
                        data-testid={`design-policy-delete-${p.slug}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create / edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit design policy" : "New design policy"}
            </DialogTitle>
            <DialogDescription>
              Principle / Rationale / Enforcement. Agents read these over the API.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="dp-name">Name</Label>
                <Input
                  id="dp-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  data-testid="dp-field-name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-slug">Slug</Label>
                <Input
                  id="dp-slug"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  disabled={editing !== null}
                  data-testid="dp-field-slug"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dp-principle">Principle</Label>
              <Textarea
                id="dp-principle"
                rows={2}
                value={form.principle}
                onChange={(e) => set("principle", e.target.value)}
                data-testid="dp-field-principle"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dp-rationale">Rationale</Label>
              <Textarea
                id="dp-rationale"
                rows={2}
                value={form.rationale}
                onChange={(e) => set("rationale", e.target.value)}
                data-testid="dp-field-rationale"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dp-enforcement">Enforcement</Label>
              <Textarea
                id="dp-enforcement"
                rows={2}
                value={form.enforcement}
                onChange={(e) => set("enforcement", e.target.value)}
                data-testid="dp-field-enforcement"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="dp-category">Category</Label>
                <Input
                  id="dp-category"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  data-testid="dp-field-category"
                />
              </div>
              <div className="space-y-1">
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) => set("severity", v as Severity)}
                >
                  <SelectTrigger data-testid="dp-field-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="dp-applies-to">Applies to</Label>
                <Input
                  id="dp-applies-to"
                  placeholder="**/*.{tsx,css}"
                  value={form.applies_to}
                  onChange={(e) => set("applies_to", e.target.value)}
                  data-testid="dp-field-applies-to"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dp-sort">Sort order</Label>
                <Input
                  id="dp-sort"
                  type="number"
                  min={0}
                  value={form.sort_order}
                  onChange={(e) =>
                    set("sort_order", Number(e.target.value) || 0)
                  }
                  data-testid="dp-field-sort-order"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={form.enabled}
                onCheckedChange={(c) => set("enabled", c)}
                data-testid="dp-field-enabled"
              />
              <Label>Enabled</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={saving || !canSubmit}
              data-testid="dp-submit"
            >
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete policy?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.name}&rdquo; will be permanently removed for
              this tenant.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleteTarget) await remove(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset confirm */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all custom policies for this tenant and restores the
              built-in set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await reset();
                setResetOpen(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
