"use client";

import { useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { TagInput } from "@/components/builders/TagInput";
import {
  type SavedApiRequest,
  runnerApi,
  useSavedApiRequestsDetailed,
} from "@/lib/runner-api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, ArrowRightLeft, Save, Trash2, X, Plus, Copy, ChevronDown, FileCode, Play } from "lucide-react";

interface HeaderEntry {
  key: string;
  value: string;
}

function getMethodColor(method: string): string {
  switch (method) {
    case "GET":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "POST":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "PUT":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "PATCH":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "DELETE":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function headersToEntries(
  headers?: Record<string, string>
): HeaderEntry[] {
  if (!headers || Object.keys(headers).length === 0) return [];
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

function entriesToHeaders(entries: HeaderEntry[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const k = entry.key.trim();
    if (k) {
      result[k] = entry.value;
    }
  }
  return result;
}

const defaultForm: Omit<SavedApiRequest, "id"> = {
  name: "",
  description: "",
  method: "GET",
  url: "",
  headers: {},
  body: "",
  body_content_type: "application/json",
  category: "",
  tags: [],
  timeout_ms: 30000,
  follow_redirects: true,
};

export default function ApiRequestsBuilderPage() {
  const searchParams = useSearchParams();
  const initialId = searchParams.get("id");

  const {
    data: requests,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useSavedApiRequestsDetailed();

  const [selectedRequest, setSelectedRequest] =
    useState<SavedApiRequest | null>(null);
  const [editForm, setEditForm] =
    useState<Omit<SavedApiRequest, "id">>(defaultForm);
  const [headerEntries, setHeaderEntries] = useState<HeaderEntry[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [aiResult, setAiResult] = useState<Record<string, any> | null>(null);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const [curlImporting, setCurlImporting] = useState(false);

  const handleSelect = useCallback(
    (item: SavedApiRequest | null) => {
      if (item) {
        setSelectedRequest(item);
        setEditForm({
          name: item.name,
          description: item.description ?? "",
          method: item.method,
          url: item.url,
          headers: item.headers ?? {},
          body: item.body ?? "",
          body_content_type: item.body_content_type ?? "application/json",
          category: item.category ?? "",
          tags: item.tags ?? [],
          timeout_ms: item.timeout_ms ?? 30000,
          follow_redirects: item.follow_redirects ?? true,
        });
        setHeaderEntries(headersToEntries(item.headers));
        setIsNew(false);
      } else {
        setSelectedRequest(null);
        setIsNew(false);
      }
    },
    []
  );

  const handleNew = useCallback(() => {
    setSelectedRequest(null);
    setEditForm({ ...defaultForm });
    setHeaderEntries([]);
    setIsNew(true);
  }, []);

  const handleSave = useCallback(async () => {
    const headers = entriesToHeaders(headerEntries);
    const payload: Partial<SavedApiRequest> = {
      ...editForm,
      headers,
    };

    try {
      if (isNew) {
        const created = await runnerApi.createSavedApiRequest(payload);
        await refetch();
        setSelectedRequest(created);
        setIsNew(false);
        toast.success("API request created");
      } else if (selectedRequest) {
        const updated = await runnerApi.updateSavedApiRequest(
          selectedRequest.id,
          payload
        );
        await refetch();
        setSelectedRequest(updated);
        toast.success("API request updated");
      }
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [editForm, headerEntries, isNew, selectedRequest, refetch]);

  const handleDelete = useCallback(
    async (ids: string[]) => {
      try {
        for (const id of ids) {
          await runnerApi.deleteSavedApiRequest(id);
        }
        await refetch();
        if (selectedRequest && ids.includes(selectedRequest.id)) {
          setSelectedRequest(null);
          setIsNew(false);
        }
        toast.success(
          `Deleted ${ids.length} request${ids.length !== 1 ? "s" : ""}`
        );
      } catch (err) {
        toast.error(
          `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [refetch, selectedRequest]
  );

  const handleDeleteCurrent = useCallback(async () => {
    if (!selectedRequest) return;
    await handleDelete([selectedRequest.id]);
  }, [selectedRequest, handleDelete]);

  const handleDuplicate = useCallback(async () => {
    if (!selectedRequest || isNew) return;
    try {
      const duplicated = await runnerApi.duplicateSavedApiRequest(selectedRequest.id);
      await refetch();
      setSelectedRequest(duplicated);
      toast.success("Request duplicated");
    } catch (err) {
      toast.error(
        `Failed to duplicate: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [selectedRequest, isNew, refetch]);

  const updateField = <K extends keyof Omit<SavedApiRequest, "id">>(
    field: K,
    value: Omit<SavedApiRequest, "id">[K]
  ) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const addHeaderEntry = () => {
    setHeaderEntries((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeHeaderEntry = (index: number) => {
    setHeaderEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const updateHeaderEntry = (
    index: number,
    field: "key" | "value",
    value: string
  ) => {
    setHeaderEntries((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry
      )
    );
  };

  const showBody = editForm.method !== "GET";

  const handleAiGenerate = async (prompt: string) => {
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const result = await runnerApi.aiGenerateApiRequest(prompt);
      if (result.success && result.data) {
        setAiResult(result.data);
      } else {
        setAiError(result.message ?? "Generation failed");
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiAccept = () => {
    if (aiResult) {
      setEditForm(f => ({
        ...f,
        name: aiResult.name ?? f.name,
        description: aiResult.description ?? f.description,
        method: aiResult.method ?? f.method,
        url: aiResult.url ?? f.url,
        body: aiResult.body ?? f.body,
        body_content_type: aiResult.body_content_type ?? f.body_content_type,
        timeout_ms: aiResult.timeout_ms ?? f.timeout_ms,
      }));
      if (aiResult.headers) {
        setHeaderEntries(headersToEntries(aiResult.headers));
      }
      setAiResult(null);
    }
  };

  const apiTemplates = [
    { label: "GET endpoint", prompt: "Generate a GET request to fetch a list of items from a REST API" },
    { label: "POST JSON", prompt: "Generate a POST request with JSON body to create a new resource" },
    { label: "Auth header", prompt: "Generate a request with Bearer token authentication" },
    { label: "Webhook", prompt: "Generate a webhook POST request with event payload" },
  ];

  const handleCurlImport = async () => {
    if (!curlInput.trim()) return;
    setCurlImporting(true);
    try {
      const parsed = await runnerApi.importCurl(curlInput.trim());
      if (parsed) {
        setEditForm(f => ({
          ...f,
          method: parsed.method ?? f.method,
          url: parsed.url ?? f.url,
          body: parsed.body ?? f.body,
          body_content_type: parsed.content_type ?? f.body_content_type,
        }));
        if (parsed.headers) {
          setHeaderEntries(headersToEntries(parsed.headers));
        }
        setCurlInput("");
        setCurlImportOpen(false);
        toast.success("cURL imported");
      }
    } catch (err) {
      toast.error(`cURL import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setCurlImporting(false);
    }
  };

  const handleTestRequest = async () => {
    try {
      const headers = entriesToHeaders(headerEntries);
      const result = await runnerApi.testApiRequest(
        editForm.method, editForm.url, headers,
        showBody ? editForm.body ?? undefined : undefined,
        editForm.body_content_type ?? undefined,
        editForm.timeout_ms ?? 30000,
        editForm.follow_redirects ?? true
      );
      if (result.success) {
        toast.success(`${result.status_code} ${result.status_text} (${result.response_time_ms}ms)`);
      } else {
        toast.error(result.error ?? "Request failed");
      }
    } catch (err) {
      toast.error(`Test failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <BuilderLayout<SavedApiRequest>
      title="API Requests"
      icon={Globe}
      iconColor="text-purple-400"
      accentColor="purple"
      items={requests ?? null}
      isLoading={isLoading}
      error={error}
      isOffline={isOffline}
      selectedItem={selectedRequest}
      onSelect={handleSelect}
      onNew={handleNew}
      onDelete={handleDelete}
      refetch={refetch}
      emptyIcon={ArrowRightLeft}
      emptyTitle="No saved API requests yet"
      emptyDescription="Create your first API request to get started."
      itemLabel="request"
      searchPlaceholder="Search requests..."
      initialSelectedId={initialId}
      renderListItem={(item) => (
        <div className="flex items-center gap-2 min-w-0">
          <Badge
            variant="outline"
            className={`font-mono text-[10px] shrink-0 px-1.5 ${getMethodColor(item.method)}`}
          >
            {item.method}
          </Badge>
          <span data-content-role="label" data-content-label="request name" className="text-sm text-text-primary truncate">
            {item.name}
          </span>
        </div>
      )}
      renderEditor={(item) => (
        <div className="p-6 space-y-6">
          {/* Editor Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Globe className="size-5 text-purple-400" />
              <h2 className="text-lg font-semibold text-text-primary">
                {isNew ? "New API Request" : item.name}
              </h2>
              {!isNew && (
                <Badge
                  variant="outline"
                  className={`font-mono text-xs ${getMethodColor(item.method)}`}
                >
                  {item.method}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isNew && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  onClick={handleDeleteCurrent}
                >
                  <Trash2 className="size-4 mr-1" />
                  Delete
                </Button>
              )}
              {!isNew && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-text-muted"
                  onClick={handleDuplicate}
                >
                  <Copy className="size-4" />
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleTestRequest} disabled={!editForm.url}>
                <Play className="size-3.5" /> Test
              </Button>
              <Button
                variant="brand-primary"
                size="sm"
                onClick={handleSave}
                disabled={!editForm.name.trim()}
              >
                <Save className="size-4 mr-1" />
                {isNew ? "Create" : "Save"}
              </Button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* AI Generator */}
            <AiGeneratorPanel
              title="Generate with AI"
              accentColor="indigo"
              templates={apiTemplates}
              placeholder="Describe the API request you need..."
              generating={aiGenerating}
              error={aiError}
              onGenerate={handleAiGenerate}
              result={aiResult ? (
                <div className="space-y-2">
                  {aiResult.method && <Badge variant="outline" className={`font-mono text-xs ${getMethodColor(aiResult.method)}`}>{aiResult.method}</Badge>}
                  {aiResult.url && <p className="text-xs font-mono text-text-secondary truncate">{aiResult.url}</p>}
                  {aiResult.name && <p className="text-sm text-text-primary">{aiResult.name}</p>}
                </div>
              ) : undefined}
              onAccept={handleAiAccept}
              onRegenerate={() => setAiResult(null)}
              acceptLabel="Use Request"
            />

            {/* cURL Import */}
            <Collapsible open={curlImportOpen} onOpenChange={setCurlImportOpen}>
              <CollapsibleTrigger asChild>
                <button type="button" className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-surface-raised/50 border border-border-subtle hover:border-text-muted transition-colors text-left text-sm font-medium text-text-secondary">
                  <FileCode className="size-4 text-text-muted" />
                  <span className="flex-1">Import from cURL</span>
                  <ChevronDown className={`size-4 text-text-muted transition-transform ${curlImportOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 space-y-2 p-3 rounded-lg border border-border-subtle bg-surface-raised/30">
                  <Textarea
                    value={curlInput}
                    onChange={e => setCurlInput(e.target.value)}
                    placeholder="Paste your cURL command here..."
                    rows={3}
                    className="font-mono text-xs bg-surface-canvas/50"
                  />
                  <Button size="sm" onClick={handleCurlImport} disabled={curlImporting || !curlInput.trim()}>
                    {curlImporting ? "Importing..." : "Import"}
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="req-name" className="text-sm text-text-secondary">
                Name
              </Label>
              <Input
                id="req-name"
                value={editForm.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Request name"
                className="bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label
                htmlFor="req-description"
                className="text-sm text-text-secondary"
              >
                Description
              </Label>
              <Textarea
                id="req-description"
                value={editForm.description ?? ""}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Optional description"
                rows={2}
                className="bg-surface-raised/50 border-border-subtle resize-none"
              />
            </div>

            {/* Method + URL Row */}
            <div className="flex gap-3">
              <div className="space-y-1.5 w-36 shrink-0">
                <Label className="text-sm text-text-secondary">Method</Label>
                <Select
                  value={editForm.method}
                  onValueChange={(val) => updateField("method", val)}
                >
                  <SelectTrigger className="bg-surface-raised/50 border-border-subtle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                    <SelectItem value="PATCH">PATCH</SelectItem>
                    <SelectItem value="DELETE">DELETE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="req-url" className="text-sm text-text-secondary">
                  URL
                </Label>
                <Input
                  id="req-url"
                  value={editForm.url}
                  onChange={(e) => updateField("url", e.target.value)}
                  placeholder="https://api.example.com/endpoint"
                  className="bg-surface-raised/50 border-border-subtle font-mono text-sm"
                />
              </div>
            </div>

            {/* Headers */}
            <div className="space-y-2">
              <Label className="text-sm text-text-secondary">Headers</Label>
              {headerEntries.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={entry.key}
                    onChange={(e) =>
                      updateHeaderEntry(index, "key", e.target.value)
                    }
                    placeholder="Header name"
                    className="bg-surface-raised/50 border-border-subtle flex-1 font-mono text-sm"
                  />
                  <Input
                    value={entry.value}
                    onChange={(e) =>
                      updateHeaderEntry(index, "value", e.target.value)
                    }
                    placeholder="Header value"
                    className="bg-surface-raised/50 border-border-subtle flex-1 font-mono text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-9 w-9 p-0 text-text-muted hover:text-red-400"
                    onClick={() => removeHeaderEntry(index)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={addHeaderEntry}
              >
                <Plus className="size-3.5 mr-1" />
                Add Header
              </Button>
            </div>

            {/* Body (hidden for GET) */}
            {showBody && (
              <>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="req-body"
                    className="text-sm text-text-secondary"
                  >
                    Body
                  </Label>
                  <Textarea
                    id="req-body"
                    value={editForm.body ?? ""}
                    onChange={(e) => updateField("body", e.target.value)}
                    placeholder="Request body"
                    rows={4}
                    className="bg-surface-raised/50 border-border-subtle font-mono text-sm resize-none"
                  />
                </div>

                <div className="space-y-1.5 w-72">
                  <Label className="text-sm text-text-secondary">
                    Body Content Type
                  </Label>
                  <Select
                    value={editForm.body_content_type ?? "application/json"}
                    onValueChange={(val) =>
                      updateField("body_content_type", val)
                    }
                  >
                    <SelectTrigger className="bg-surface-raised/50 border-border-subtle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="application/json">
                        application/json
                      </SelectItem>
                      <SelectItem value="text/plain">text/plain</SelectItem>
                      <SelectItem value="application/xml">
                        application/xml
                      </SelectItem>
                      <SelectItem value="application/x-www-form-urlencoded">
                        application/x-www-form-urlencoded
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Category */}
            <div className="space-y-1.5">
              <Label
                htmlFor="req-category"
                className="text-sm text-text-secondary"
              >
                Category
              </Label>
              <Input
                id="req-category"
                value={editForm.category ?? ""}
                onChange={(e) => updateField("category", e.target.value)}
                placeholder="e.g. auth, data, webhook"
                className="bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-sm text-text-secondary">Tags</Label>
              <TagInput
                tags={editForm.tags ?? []}
                onChange={(tags) => updateField("tags", tags)}
                placeholder="Add tag and press Enter..."
              />
            </div>

            {/* Timeout */}
            <div className="space-y-1.5 w-48">
              <Label
                htmlFor="req-timeout"
                className="text-sm text-text-secondary"
              >
                Timeout (ms)
              </Label>
              <Input
                id="req-timeout"
                type="number"
                value={editForm.timeout_ms ?? 30000}
                onChange={(e) =>
                  updateField("timeout_ms", parseInt(e.target.value, 10) || 0)
                }
                className="bg-surface-raised/50 border-border-subtle"
              />
            </div>

            {/* Follow Redirects */}
            <div className="flex items-center gap-3">
              <Switch
                id="req-follow-redirects"
                checked={editForm.follow_redirects ?? true}
                onCheckedChange={(checked) =>
                  updateField("follow_redirects", checked)
                }
              />
              <Label
                htmlFor="req-follow-redirects"
                className="text-sm text-text-secondary cursor-pointer"
              >
                Follow redirects
              </Label>
            </div>
          </div>
        </div>
      )}
    />
  );
}
