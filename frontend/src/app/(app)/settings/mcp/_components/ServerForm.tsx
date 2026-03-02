"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Save, Terminal, Globe } from "lucide-react";
import type { ServerFormData } from "../types";

export function ServerForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing,
}: {
  initialData: ServerFormData;
  onSubmit: (data: ServerFormData) => Promise<void>;
  onCancel: () => void;
  isEditing: boolean;
}) {
  const [form, setForm] = useState<ServerFormData>(initialData);
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<ServerFormData>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Server name is required");
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      toast.error("Command is required for stdio transport");
      return;
    }
    if (form.transport === "http" && !form.url.trim()) {
      toast.error("Server URL is required for HTTP transport");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium">
          {isEditing ? "Edit Server" : "Add Server"}
        </h3>
      </div>
      <div className="p-4 space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <Label className="text-sm text-foreground">
            Name <span className="text-red-400">*</span>
          </Label>
          <Input
            placeholder="e.g., filesystem-mcp"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-muted border-border"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-sm text-foreground">Description</Label>
          <Input
            placeholder="Optional description"
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            className="bg-muted border-border"
          />
        </div>

        {/* Transport */}
        <div className="space-y-1.5">
          <Label className="text-sm text-foreground">Transport</Label>
          <div className="flex gap-2">
            <button
              onClick={() => update({ transport: "stdio" })}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
                form.transport === "stdio"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Terminal className="size-4" />
              Stdio
            </button>
            <button
              onClick={() => update({ transport: "http" })}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
                form.transport === "http"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Globe className="size-4" />
              HTTP
            </button>
          </div>
        </div>

        {/* Stdio fields */}
        {form.transport === "stdio" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">
                Command <span className="text-red-400">*</span>
              </Label>
              <Input
                placeholder="e.g., npx -y @modelcontextprotocol/server-filesystem"
                value={form.command}
                onChange={(e) => update({ command: e.target.value })}
                className="bg-muted border-border font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">
                Arguments (one per line)
              </Label>
              <Textarea
                placeholder={"/path/to/allowed/dir\n/another/path"}
                value={form.args}
                onChange={(e) => update({ args: e.target.value })}
                rows={3}
                className="bg-muted border-border font-mono text-sm resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">
                Working Directory
              </Label>
              <Input
                placeholder="e.g., C:\projects\my-app"
                value={form.cwd}
                onChange={(e) => update({ cwd: e.target.value })}
                className="bg-muted border-border text-sm"
              />
            </div>
          </>
        )}

        {/* HTTP fields */}
        {form.transport === "http" && (
          <>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">
                Server URL <span className="text-red-400">*</span>
              </Label>
              <Input
                placeholder="http://localhost:3001/mcp"
                value={form.url}
                onChange={(e) => update({ url: e.target.value })}
                className="bg-muted border-border font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground">
                Headers (JSON or key:value per line)
              </Label>
              <Textarea
                placeholder={'{"Authorization": "Bearer token"}'}
                value={form.headers}
                onChange={(e) => update({ headers: e.target.value })}
                rows={3}
                className="bg-muted border-border font-mono text-sm resize-none"
              />
            </div>
          </>
        )}

        {/* Timeout */}
        <div className="space-y-1.5">
          <Label className="text-sm text-foreground">Timeout (seconds)</Label>
          <Input
            type="number"
            min={1}
            max={300}
            value={form.timeout_seconds}
            onChange={(e) =>
              update({ timeout_seconds: Number(e.target.value) || 30 })
            }
            className="bg-muted border-border text-sm w-32"
          />
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
            />
            <Label className="text-sm text-foreground">Enabled</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.auto_start}
              onCheckedChange={(v) => update({ auto_start: v })}
            />
            <Label className="text-sm text-foreground">Auto-start</Label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isEditing ? "Update" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
