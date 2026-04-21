"use client";

/**
 * /vga/builder/new — two-step wizard.
 *
 * Step 1: "Target" form creates an empty SM via POST /api/vga/state.
 * Step 2 (alt): "Import from JSON" accepts a canonical export and
 * creates a new SM via POST /api/vga/state/import.
 *
 * On success, pushes to /vga/builder/[id] for the real editing UI.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, FileJson, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  createStateMachine,
  importStateMachine,
} from "../../_components/api-client";

const OS_OPTIONS = ["Windows", "macOS", "Linux"] as const;
type OsOption = (typeof OS_OPTIONS)[number];

export default function NewVgaSmPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [targetProcess, setTargetProcess] = useState("");
  const [targetOs, setTargetOs] = useState<OsOption>("Windows");
  const [groundingModel, setGroundingModel] = useState("qontinui-grounding-v5");
  const [isPrivate, setIsPrivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importNameOverride, setImportNameOverride] = useState("");
  const [importing, setImporting] = useState(false);

  const canSubmit =
    name.trim().length > 0 && targetProcess.trim().length > 0 && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const sm = await createStateMachine({
        name: name.trim(),
        targetProcess: targetProcess.trim(),
        targetOs,
        groundingModel,
        private: isPrivate,
        stateGraph: { states: [], transitions: [] },
      });
      toast.success("State machine created");
      router.push(`/vga/builder/${sm.id}`);
    } catch (err) {
      toast.error(`Failed to create state machine: ${(err as Error).message}`);
      setSubmitting(false);
    }
  }

  async function handleImport() {
    if (importing) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(importJsonText);
    } catch (err) {
      toast.error(`Invalid JSON: ${(err as Error).message}`);
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      toast.error("Canonical JSON must be an object");
      return;
    }
    const obj = parsed as Record<string, unknown>;
    // Accept either { canonical: {...} } wrapper or the raw canonical
    // object — unwrap / wrap accordingly for a friendlier paste UX.
    const canonical =
      "canonical" in obj && typeof obj.canonical === "object"
        ? (obj.canonical as Parameters<typeof importStateMachine>[0])
        : (obj as unknown as Parameters<typeof importStateMachine>[0]);
    setImporting(true);
    try {
      const sm = await importStateMachine(
        canonical,
        importNameOverride.trim() || undefined
      );
      toast.success("Imported state machine");
      setImportOpen(false);
      router.push(`/vga/builder/${sm.id}`);
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
      setImporting(false);
    }
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/vga" aria-label="Back to VGA landing">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">New VGA state machine</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4" /> Target
              </CardTitle>
              <CardDescription>
                Describe the target app. You can refine everything later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sm-name">Name</Label>
                <Input
                  id="sm-name"
                  placeholder="e.g. Notepad++ main window"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sm-target-process">Target process</Label>
                <Input
                  id="sm-target-process"
                  placeholder="e.g. notepad++.exe"
                  value={targetProcess}
                  onChange={(e) => setTargetProcess(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Win32 window-title substring or process name. Used by the
                  runner HAL to focus the window before grounding.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="sm-target-os">Target OS</Label>
                  <Select
                    value={targetOs}
                    onValueChange={(v) => setTargetOs(v as OsOption)}
                  >
                    <SelectTrigger id="sm-target-os">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OS_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sm-grounding-model">Grounding model</Label>
                  <Select
                    value={groundingModel}
                    onValueChange={setGroundingModel}
                  >
                    <SelectTrigger id="sm-grounding-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="qontinui-grounding-v5">
                        qontinui-grounding-v5
                      </SelectItem>
                      <SelectItem value="qontinui-grounding-v6" disabled>
                        qontinui-grounding-v6 (coming soon)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-start gap-3 rounded-md border border-border p-3">
                <Checkbox
                  id="sm-private"
                  checked={isPrivate}
                  onCheckedChange={(v) => setIsPrivate(v === true)}
                />
                <div className="space-y-0.5">
                  <span className="text-sm font-medium">Private</span>
                  <p className="text-xs text-muted-foreground">
                    Private state machines are never exported to a training set.
                    Turn this off if you want to contribute corrections to the
                    next model version.
                  </p>
                </div>
              </label>
              <div className="flex items-center justify-between gap-2 pt-2">
                <Dialog open={importOpen} onOpenChange={setImportOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" type="button">
                      <FileJson className="size-4" /> Import from JSON
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Import canonical VGA JSON</DialogTitle>
                      <DialogDescription>
                        Paste a canonical export (the body of GET
                        /api/vga/state/&lt;id&gt;.json) to create a new state
                        machine from it.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="import-name">
                          Name override (optional)
                        </Label>
                        <Input
                          id="import-name"
                          value={importNameOverride}
                          onChange={(e) =>
                            setImportNameOverride(e.target.value)
                          }
                          placeholder="Leave blank to keep imported name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="import-json">Canonical JSON</Label>
                        <Textarea
                          id="import-json"
                          value={importJsonText}
                          onChange={(e) => setImportJsonText(e.target.value)}
                          className="font-mono text-xs min-h-[300px]"
                          placeholder='{ "canonical": { "name": "...", ... } }'
                        />
                        <p className="text-xs text-muted-foreground">
                          Body shape:{" "}
                          <Badge
                            variant="outline"
                            className="font-mono"
                          >{`{ canonical: {...} }`}</Badge>{" "}
                          — or the raw canonical object (we will wrap it).
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setImportOpen(false)}
                        disabled={importing}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleImport}
                        disabled={
                          importing || importJsonText.trim().length === 0
                        }
                      >
                        {importing && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Import
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button onClick={handleCreate} disabled={!canSubmit}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  Create and open builder
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
