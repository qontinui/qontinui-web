"use client";

import { useState, useMemo } from "react";
import {
  Search,
  Plus,
  Trash2,
  Save,
  X,
  Code2,
  Tag,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MonacoField } from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import {
  useRunnerPromptSnippetsList,
  useCreateRunnerPromptSnippet,
  useUpdateRunnerPromptSnippet,
  useDeleteRunnerPromptSnippet,
} from "@/components/builders/hooks/useRunnerEntity";
import type { PromptSnippet } from "@/lib/runner/types/library";
import { toast } from "sonner";

// =============================================================================
// Types
// =============================================================================

interface SnippetForm {
  name: string;
  content: string;
  category: string;
  tags: string[];
}

function emptyForm(): SnippetForm {
  return { name: "", content: "", category: "", tags: [] };
}

function toForm(s: PromptSnippet): SnippetForm {
  return {
    name: s.name,
    content: s.content,
    category: s.category ?? "",
    tags: s.tags ?? [],
  };
}

// =============================================================================
// PromptSnippetManager
// =============================================================================

interface PromptSnippetManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PromptSnippetManager({
  open,
  onOpenChange,
}: PromptSnippetManagerProps) {
  const { data: snippets, isLoading } = useRunnerPromptSnippetsList();
  const createMutation = useCreateRunnerPromptSnippet();
  const updateMutation = useUpdateRunnerPromptSnippet();
  const deleteMutation = useDeleteRunnerPromptSnippet();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<SnippetForm>(emptyForm());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    if (!snippets) return [];
    if (!search.trim()) return snippets;
    const q = search.toLowerCase();
    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q) ||
        s.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [snippets, search]);

  const handleSelect = (snippet: PromptSnippet) => {
    setSelectedId(snippet.id);
    setIsNew(false);
    setForm(toForm(snippet));
  };

  const handleNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm(emptyForm());
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        content: form.content,
        category: form.category || undefined,
        tags: form.tags.length > 0 ? form.tags : undefined,
      };
      if (isNew) {
        const created = await createMutation.mutateAsync(payload);
        setSelectedId(created.id);
        setIsNew(false);
        toast.success("Snippet created");
      } else if (selectedId) {
        await updateMutation.mutateAsync({ id: selectedId, data: payload });
        toast.success("Snippet saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId || isNew) return;
    try {
      await deleteMutation.mutateAsync(selectedId);
      setSelectedId(null);
      setForm(emptyForm());
      toast.success("Snippet deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border-subtle">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Code2 className="size-4 text-indigo-400" />
            Manage Prompt Snippets
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[65vh]">
          {/* Left: List */}
          <div className="w-64 border-r border-border-subtle flex flex-col shrink-0">
            {/* Search + New */}
            <div className="p-2 space-y-2 border-b border-border-subtle/50">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search snippets..."
                  className="pl-7 h-7 text-xs bg-surface-raised/50 border-border-subtle"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs gap-1.5"
                onClick={handleNew}
              >
                <Plus className="size-3" />
                New Snippet
              </Button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-4 animate-spin text-text-muted" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-text-muted text-center py-8">
                  No snippets found
                </p>
              ) : (
                filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelect(s)}
                    className={`w-full text-left px-3 py-2 border-b border-border-subtle/30 transition-colors ${
                      selectedId === s.id
                        ? "bg-indigo-500/10 border-l-2 border-l-indigo-400"
                        : "hover:bg-surface-hover"
                    }`}
                  >
                    <div className="text-xs font-medium text-text-primary truncate">
                      {s.name}
                    </div>
                    {s.category && (
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1 mt-1"
                      >
                        {s.category}
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: Editor */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!selectedId && !isNew ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted">
                <Code2 className="size-8 mb-2 opacity-30" />
                <p className="text-xs">Select a snippet or create a new one</p>
              </div>
            ) : (
              <>
                {/* Name */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-text-muted">Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Snippet name..."
                    className="h-8 text-sm bg-surface-raised/50 border-border-subtle"
                  />
                </div>

                {/* Content */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-text-muted">Content</Label>
                  <MonacoField
                    value={form.content}
                    onChange={(content) => setForm({ ...form, content })}
                    language="markdown"
                    height="250px"
                  />
                </div>

                {/* Category */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-text-muted">Category</Label>
                  <Input
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    placeholder="e.g., instructions, context, templates"
                    className="h-8 text-sm bg-surface-raised/50 border-border-subtle"
                  />
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-text-muted flex items-center gap-1">
                    <Tag className="size-3" />
                    Tags
                  </Label>
                  <TagInput
                    tags={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    placeholder="Add tag..."
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-border-subtle/50">
                  <Button
                    size="sm"
                    className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Save className="size-3" />
                    )}
                    {isNew ? "Create" : "Save"}
                  </Button>
                  {!isNew && selectedId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10"
                      onClick={handleDelete}
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto gap-1.5 text-text-muted"
                    onClick={() => onOpenChange(false)}
                  >
                    <X className="size-3" />
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
