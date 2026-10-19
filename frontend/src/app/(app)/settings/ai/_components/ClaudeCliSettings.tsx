import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import Link from "next/link";
import { Terminal } from "lucide-react";
import type { DerivedAccountSelection } from "../_hooks/useAiSettings";
import { EXECUTION_MODES, type ClaudeCliConfig } from "../types";

const LOCAL_MODES = [
  { value: "manual", label: "Manual" },
  { value: "least_usage", label: "Least usage" },
  { value: "highest_expected_usage", label: "Highest expected usage" },
] as const;

/**
 * Mirror of the runner's `resolve_selection` (claude_accounts.rs): pinned ->
 * the local mode; else the fleet value if present; else the local mode.
 * Returns undefined (UNKNOWN) when the answer hinges on a key that is absent.
 * A preview only — never the mode "in use".
 */
export function previewAccountSelection(
  local: string | null | undefined,
  pinned: boolean | null | undefined,
  fleet: string | null | undefined
): string | undefined {
  if (pinned) return local ?? undefined;
  if (fleet !== undefined && fleet !== null) return fleet;
  if (fleet === null) return local ?? undefined;
  return undefined;
}

const SOURCE_LABEL: Record<string, string> = {
  fleet: "Managed by fleet policy",
  local: "Local setting",
  pinned: "Pinned locally (overrides fleet)",
};

interface ClaudeCliSettingsProps {
  config: ClaudeCliConfig;
  onChange: (config: ClaudeCliConfig) => void;
  /** Read-only derived keys from GET /settings/ai; each may be absent. */
  derived?: DerivedAccountSelection;
  /** Whether the viewer can reach /admin (plain text otherwise). */
  canReachAdmin?: boolean;
  /** Show the preview only while the pin / local mode has unsaved edits. */
  previewEnabled?: boolean;
}

export function ClaudeCliSettings({
  config,
  onChange,
  derived = {},
  canReachAdmin = false,
  previewEnabled = false,
}: ClaudeCliSettingsProps) {
  const preview = previewAccountSelection(
    config.account_selection_mode,
    config.account_selection_pinned,
    derived.fleet
  );
  const sourceText =
    derived.source === undefined
      ? "Source: unknown"
      : SOURCE_LABEL[derived.source];
  return (
    <div className="rounded-lg border border-border">
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="size-4" />
          Claude CLI Settings
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <Label>Execution Mode</Label>
          <Select
            value={config.execution_mode}
            onValueChange={(v) => onChange({ ...config, execution_mode: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Custom Executable Path</Label>
          <Input
            placeholder="Leave empty for default"
            value={config.custom_path ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                custom_path: e.target.value || null,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>Config Directory</Label>
          <Input
            placeholder="Leave empty for default"
            value={config.config_dir ?? ""}
            onChange={(e) =>
              onChange({
                ...config,
                config_dir: e.target.value || null,
              })
            }
          />
        </div>

        <div
          className="space-y-3 rounded-md border border-border p-3"
          data-testid="account-selection"
        >
          <Label>Account selection</Label>
          <p className="text-sm" data-testid="effective-mode">
            Effective mode (in use):{" "}
            <strong>{derived.effective ?? "unknown"}</strong>
          </p>
          <p className="text-sm text-muted-foreground" data-testid="source">
            {derived.source === "fleet" ? (
              <>
                {canReachAdmin ? (
                  <Link href="/admin/coord/tenant-policy" className="underline">
                    {SOURCE_LABEL.fleet}
                  </Link>
                ) : (
                  SOURCE_LABEL.fleet
                )}
              </>
            ) : (
              sourceText
            )}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="fleet-mode">
            Fleet value:{" "}
            {derived.fleet === undefined
              ? "unknown"
              : derived.fleet === null
                ? "no fleet opinion"
                : derived.fleet}
          </p>

          <div className="space-y-2">
            <Label>Local mode</Label>
            <Select
              value={config.account_selection_mode ?? undefined}
              onValueChange={(v) =>
                onChange({ ...config, account_selection_mode: v })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                {LOCAL_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="account-selection-pinned"
              checked={config.account_selection_pinned === true}
              onCheckedChange={(v) =>
                onChange({ ...config, account_selection_pinned: v })
              }
            />
            <Label htmlFor="account-selection-pinned">
              Pin local mode (the pin makes the local mode win over the fleet
              policy value)
            </Label>
          </div>

          {previewEnabled && (
            <p className="text-sm text-muted-foreground" data-testid="preview">
              Would apply after save: <strong>{preview ?? "unknown"}</strong>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Timeout (seconds)</Label>
          <Input
            type="number"
            min={60}
            max={3600}
            value={config.timeout_seconds}
            onChange={(e) =>
              onChange({
                ...config,
                timeout_seconds: Number(e.target.value),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
