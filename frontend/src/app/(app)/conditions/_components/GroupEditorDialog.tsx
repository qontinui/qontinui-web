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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type {
  ConditionAuthSetup,
  ConditionGroup,
  ConditionGroupCreate,
  ConditionGroupUpdate,
} from "../types";

interface GroupEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this group; otherwise it creates a new one. */
  group: ConditionGroup | null;
  saving: boolean;
  onCreate: (data: ConditionGroupCreate) => Promise<boolean>;
  onUpdate: (id: string, data: ConditionGroupUpdate) => Promise<boolean>;
}

/**
 * Schedule presets the operator picks from. `"none"` = on demand only (no
 * schedule); the rest map to an interval in seconds. Kept as a small fixed set
 * for v1 — a custom interval can be added later without changing the contract.
 */
const SCHEDULE_PRESETS: {
  value: string;
  label: string;
  secs: number | null;
}[] = [
  { value: "none", label: "On demand only", secs: null },
  { value: "900", label: "Every 15 minutes", secs: 900 },
  { value: "3600", label: "Every hour", secs: 3600 },
  { value: "21600", label: "Every 6 hours", secs: 21600 },
  { value: "86400", label: "Every 24 hours", secs: 86400 },
];

/** Map an interval-in-seconds to the closest preset value (or a custom label). */
function scheduleValueFor(secs: number | null | undefined): string {
  if (secs === null || secs === undefined) return "none";
  const match = SCHEDULE_PRESETS.find((p) => p.secs === secs);
  return match ? match.value : "custom";
}

/** Parse the auth-setup textarea; returns the parsed object or an error string. */
function parseAuthSetup(
  raw: string
):
  | { ok: true; value: ConditionAuthSetup | null }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, error: "Auth setup must be a JSON object" };
    }
    return { ok: true, value: parsed as ConditionAuthSetup };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

export function GroupEditorDialog({
  open,
  onOpenChange,
  group,
  saving,
  onCreate,
  onUpdate,
}: GroupEditorDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [schedule, setSchedule] = useState("none");
  const [customSecs, setCustomSecs] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [authSetupText, setAuthSetupText] = useState("");

  // Reset the whole form whenever the dialog opens (for the active group, or blank).
  useEffect(() => {
    if (!open) return;
    if (!group) {
      setName("");
      setDescription("");
      setTargetUrl("");
      setSchedule("none");
      setCustomSecs("");
      setEnabled(true);
      setAuthSetupText("");
      return;
    }
    setName(group.name);
    setDescription(group.description ?? "");
    setTargetUrl(group.target_url);
    const sv = scheduleValueFor(group.schedule_interval_secs);
    setSchedule(sv);
    setCustomSecs(
      sv === "custom" && group.schedule_interval_secs != null
        ? String(group.schedule_interval_secs)
        : ""
    );
    setEnabled(group.enabled);
    setAuthSetupText(
      group.auth_setup ? JSON.stringify(group.auth_setup, null, 2) : ""
    );
  }, [open, group]);

  const authParse = useMemo(
    () => parseAuthSetup(authSetupText),
    [authSetupText]
  );

  const isCustom = schedule === "custom";

  const scheduleSecs = useMemo<number | null>(() => {
    if (isCustom) {
      const n = Number(customSecs);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    const preset = SCHEDULE_PRESETS.find((p) => p.value === schedule);
    return preset ? preset.secs : null;
  }, [isCustom, customSecs, schedule]);

  const canSubmit = (() => {
    if (saving) return false;
    if (name.trim().length === 0) return false;
    if (targetUrl.trim().length === 0) return false;
    if (!authParse.ok) return false;
    if (isCustom && (scheduleSecs === null || scheduleSecs <= 0)) return false;
    return true;
  })();

  const handleSubmit = async () => {
    if (!canSubmit || !authParse.ok) return;
    const base = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      target_url: targetUrl.trim(),
      auth_setup: authParse.value,
      schedule_interval_secs: scheduleSecs,
      enabled,
    };
    const ok = group
      ? await onUpdate(group.group_id, base)
      : await onCreate(base);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group ? "Edit Group" : "New Group"}</DialogTitle>
          <DialogDescription>
            A condition group is a regression test — a set of natural-language
            checks run against a target URL, on demand or on a schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Checkout page smoke checks"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-description">Description</Label>
            <Textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional — what this regression test covers"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-url">Target URL</Label>
            <Input
              id="group-url"
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com/checkout"
            />
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger data-testid="group-schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
                {isCustom && (
                  <SelectItem value="custom">Custom interval</SelectItem>
                )}
              </SelectContent>
            </Select>
            {isCustom && (
              <div className="space-y-1">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={customSecs}
                  onChange={(e) => setCustomSecs(e.target.value)}
                  placeholder="Interval in seconds"
                />
                <p className="text-xs text-muted-foreground">
                  Custom interval in seconds.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="group-enabled">Enabled</Label>
            <Switch
              id="group-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-auth">Auth setup (optional)</Label>
            <Textarea
              id="group-auth"
              value={authSetupText}
              onChange={(e) => setAuthSetupText(e.target.value)}
              rows={5}
              className="font-mono text-xs"
              // Holds credentials (username/password); redact at UI Bridge
              // snapshot time so the SDK never captures the plaintext.
              data-bridge-redact="true"
              placeholder={
                '{\n  "loginUrl": "https://example.com/login",\n  "usernameSelector": "#email",\n  "passwordSelector": "#password",\n  "username": "user@example.com",\n  "submitSelector": "button[type=submit]"\n}'
              }
              aria-invalid={!authParse.ok}
              spellCheck={false}
            />
            {authParse.ok ? (
              <p className="text-xs text-muted-foreground">
                JSON describing how to sign in before the checks run. Leave
                blank if the target needs no authentication.
              </p>
            ) : (
              <p className="text-xs text-destructive">
                Invalid JSON: {authParse.error}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {group ? "Save Changes" : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
