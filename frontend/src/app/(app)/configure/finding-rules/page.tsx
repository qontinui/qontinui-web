"use client";

import { useState, useEffect, useCallback } from "react";
import {
  apiClient,
  type FindingCategoryConfig,
  type FindingCategoryConfigCreate,
  type FindingCategoryActionType,
} from "@/lib/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Plus,
  Trash2,
  Save,
  AlertCircle,
  X,
  Settings2,
  RefreshCw,
  Search,
  RotateCcw,
  Bug,
  CheckSquare,
  Shield,
  Settings,
  CheckCircle,
  Info,
  Database,
  Activity,
  TestTube,
  Sparkles,
  FileText,
  Zap,
  AlertTriangle,
  Pencil,
  Lock,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
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

// ─── Icon registry ──────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Bug,
  CheckSquare,
  Shield,
  Settings,
  CheckCircle,
  Info,
  Database,
  Activity,
  TestTube,
  Sparkles,
  FileText,
  Zap,
  AlertTriangle,
  Pencil,
  Lock,
};

const ICON_OPTIONS = Object.keys(ICON_MAP);

function CategoryIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name] || Settings2;
  return <Icon className={className} />;
}

// ─── Color helpers ──────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
  "red",
  "amber",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "cyan",
  "slate",
];

function getColorClasses(color: string) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    red: {
      bg: "bg-red-500/10",
      text: "text-red-400",
      border: "border-red-500/30",
    },
    amber: {
      bg: "bg-amber-500/10",
      text: "text-amber-400",
      border: "border-amber-500/30",
    },
    orange: {
      bg: "bg-orange-500/10",
      text: "text-orange-400",
      border: "border-orange-500/30",
    },
    yellow: {
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      border: "border-yellow-500/30",
    },
    green: {
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/30",
    },
    blue: {
      bg: "bg-blue-500/10",
      text: "text-blue-400",
      border: "border-blue-500/30",
    },
    purple: {
      bg: "bg-purple-500/10",
      text: "text-purple-400",
      border: "border-purple-500/30",
    },
    cyan: {
      bg: "bg-cyan-500/10",
      text: "text-cyan-400",
      border: "border-cyan-500/30",
    },
    slate: {
      bg: "bg-slate-500/10",
      text: "text-slate-400",
      border: "border-slate-500/30",
    },
  };
  return (
    map[color] || {
      bg: "bg-muted",
      text: "text-muted-foreground",
      border: "border-border",
    }
  );
}

// ─── Action type helpers ────────────────────────────────────────────────────

const ACTION_TYPE_OPTIONS: {
  value: FindingCategoryActionType;
  label: string;
  description: string;
}[] = [
  {
    value: "auto_fix",
    label: "Auto Fix",
    description: "AI will attempt to fix automatically",
  },
  {
    value: "needs_user_input",
    label: "Needs User Input",
    description: "Requires user decision before acting",
  },
  { value: "manual", label: "Manual", description: "User must fix manually" },
  {
    value: "informational",
    label: "Informational",
    description: "Logged for awareness, no action needed",
  },
];

function getActionTypeBadge(actionType: string) {
  switch (actionType) {
    case "auto_fix":
      return { label: "Auto Fix", variant: "success" as const };
    case "needs_user_input":
      return { label: "User Input", variant: "warning" as const };
    case "manual":
      return { label: "Manual", variant: "info" as const };
    case "informational":
      return { label: "Info", variant: "secondary" as const };
    default:
      return { label: actionType, variant: "outline" as const };
  }
}

// ─── Slug generator ─────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function FindingRulesPage() {
  const [categories, setCategories] = useState<FindingCategoryConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIcon, setFormIcon] = useState("Bug");
  const [formColor, setFormColor] = useState("red");
  const [formActionType, setFormActionType] =
    useState<FindingCategoryActionType>("auto_fix");
  const [formEnabled, setFormEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editActionType, setEditActionType] =
    useState<FindingCategoryActionType>("auto_fix");

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset confirmation
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Toggle loading
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getFindingCategories();
      setCategories(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load categories"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormDescription("");
    setFormIcon("Bug");
    setFormColor("red");
    setFormActionType("auto_fix");
    setFormEnabled(true);
    setSaveError(null);
    setShowForm(false);
  }, []);

  const handleCreate = async () => {
    if (!formName.trim()) {
      setSaveError("Name is required");
      return;
    }

    const slug = slugify(formName);
    if (!slug) {
      setSaveError("Name must contain at least one letter or number");
      return;
    }

    if (categories.some((c) => c.slug === slug)) {
      setSaveError(`A category with slug "${slug}" already exists`);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const data: FindingCategoryConfigCreate = {
        slug,
        name: formName.trim(),
        description: formDescription.trim(),
        icon: formIcon,
        color: formColor,
        default_action_type: formActionType,
        sort_order: categories.length + 1,
        enabled: formEnabled,
      };
      await apiClient.createFindingCategory(data);
      resetForm();
      await fetchCategories();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to create category"
      );
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (cat: FindingCategoryConfig) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDescription(cat.description);
    setEditIcon(cat.icon);
    setEditColor(cat.color);
    setEditActionType(cat.default_action_type);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (cat: FindingCategoryConfig) => {
    try {
      await apiClient.updateFindingCategory(cat.id, {
        name: editName.trim() || undefined,
        description: editDescription,
        icon: editIcon,
        color: editColor,
        default_action_type: editActionType,
      });
      setEditingId(null);
      await fetchCategories();
    } catch {
      // stay in edit mode
    }
  };

  const handleToggleEnabled = async (cat: FindingCategoryConfig) => {
    setTogglingId(cat.id);
    try {
      await apiClient.updateFindingCategory(cat.id, {
        enabled: !cat.enabled,
      });
      await fetchCategories();
    } catch {
      // ignore
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteFindingCategory(deletingId);
      setDeletingId(null);
      await fetchCategories();
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const data = await apiClient.resetFindingCategories();
      setCategories(data);
      setShowResetDialog(false);
    } catch {
      // ignore
    } finally {
      setIsResetting(false);
    }
  };

  const handleReorder = async (
    cat: FindingCategoryConfig,
    direction: "up" | "down"
  ) => {
    const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((c) => c.id === cat.id);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= sorted.length - 1) return;

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const other = sorted[swapIdx];
    if (!other) return;

    try {
      await Promise.all([
        apiClient.updateFindingCategory(cat.id, {
          sort_order: other.sort_order,
        }),
        apiClient.updateFindingCategory(other.id, {
          sort_order: cat.sort_order,
        }),
      ]);
      await fetchCategories();
    } catch {
      // ignore
    }
  };

  const filteredCategories = categories.filter((cat) => {
    if (!searchQuery.trim()) return true;
    const lower = searchQuery.toLowerCase();
    return (
      cat.name.toLowerCase().includes(lower) ||
      cat.slug.toLowerCase().includes(lower) ||
      cat.description.toLowerCase().includes(lower) ||
      cat.default_action_type.toLowerCase().includes(lower)
    );
  });

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Settings2 className="w-5 h-5 text-orange-400" />
          <h1 className="text-lg font-semibold text-foreground">
            Finding Categories
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowResetDialog(true)}
            className="text-muted-foreground hover:text-white"
            title="Reset to defaults"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsLoading(true);
              fetchCategories();
            }}
            className="text-muted-foreground hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            onClick={() => setShowForm(true)}
            disabled={showForm}
            className="bg-primary hover:bg-primary/90 text-black font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Category
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto space-y-6 w-full">
        {/* Error Banner */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Create Form */}
        {showForm && (
          <Card className="bg-muted border-primary/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  New Finding Category
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-white"
                  onClick={resetForm}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Name
                  </label>
                  <Input
                    placeholder="e.g., Accessibility Issue"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="bg-muted border-border text-white placeholder:text-muted-foreground"
                  />
                  {formName.trim() && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Slug: {slugify(formName)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Description
                  </label>
                  <Input
                    placeholder="Short description"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="bg-muted border-border text-white placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Icon
                  </label>
                  <Select value={formIcon} onValueChange={setFormIcon}>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      {ICON_OPTIONS.map((icon) => (
                        <SelectItem key={icon} value={icon}>
                          <div className="flex items-center gap-2">
                            <CategoryIcon name={icon} className="w-4 h-4" />
                            {icon}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Color
                  </label>
                  <Select value={formColor} onValueChange={setFormColor}>
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      {COLOR_OPTIONS.map((color) => {
                        const cc = getColorClasses(color);
                        return (
                          <SelectItem key={color} value={color}>
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-3 h-3 rounded-full ${cc.bg} ${cc.border} border`}
                              />
                              {color.charAt(0).toUpperCase() + color.slice(1)}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                    Default Action
                  </label>
                  <Select
                    value={formActionType}
                    onValueChange={(v) =>
                      setFormActionType(v as FindingCategoryActionType)
                    }
                  >
                    <SelectTrigger className="bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-muted border-border">
                      {ACTION_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div>
                            <span>{opt.label}</span>
                            <span className="text-muted-foreground text-[11px] ml-2">
                              {opt.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  checked={formEnabled}
                  onCheckedChange={setFormEnabled}
                />
                <label className="text-sm text-muted-foreground">
                  Enable category
                </label>
              </div>

              {saveError && (
                <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <p className="text-sm">{saveError}</p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={resetForm}
                  className="text-muted-foreground hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={isSaving}
                  className="bg-primary hover:bg-primary/90 text-black font-semibold"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Create Category
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Categories List */}
        <Card className="bg-muted border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5" />
                  Categories
                </CardTitle>
                <CardDescription className="text-muted-foreground mt-1">
                  Configure how AI-detected findings are classified
                </CardDescription>
              </div>
              {categories.length > 0 && (
                <Badge variant="secondary">
                  {categories.length} categories
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search */}
            {categories.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search categories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-muted border-border text-white placeholder:text-muted-foreground"
                />
              </div>
            )}

            {!filteredCategories.length ? (
              <div className="text-center py-12">
                <Settings2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {categories.length > 0
                    ? "No categories match your search"
                    : "No categories configured."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCategories.map((cat) => {
                  const cc = getColorClasses(cat.color);
                  const actionBadge = getActionTypeBadge(
                    cat.default_action_type
                  );
                  const isEditing = editingId === cat.id;

                  if (isEditing && !cat.is_built_in) {
                    return (
                      <div
                        key={cat.id}
                        className="p-4 rounded-lg border border-primary/30 bg-background/30 space-y-3"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Category name"
                            className="bg-muted border-border text-white"
                          />
                          <Input
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description"
                            className="bg-muted border-border text-white"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <Select value={editIcon} onValueChange={setEditIcon}>
                            <SelectTrigger className="bg-muted border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-muted border-border">
                              {ICON_OPTIONS.map((icon) => (
                                <SelectItem key={icon} value={icon}>
                                  <div className="flex items-center gap-2">
                                    <CategoryIcon
                                      name={icon}
                                      className="w-4 h-4"
                                    />
                                    {icon}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={editColor}
                            onValueChange={setEditColor}
                          >
                            <SelectTrigger className="bg-muted border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-muted border-border">
                              {COLOR_OPTIONS.map((color) => {
                                const colCc = getColorClasses(color);
                                return (
                                  <SelectItem key={color} value={color}>
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={`w-3 h-3 rounded-full ${colCc.bg} ${colCc.border} border`}
                                      />
                                      {color.charAt(0).toUpperCase() +
                                        color.slice(1)}
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          <Select
                            value={editActionType}
                            onValueChange={(v) =>
                              setEditActionType(v as FindingCategoryActionType)
                            }
                          >
                            <SelectTrigger className="bg-muted border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-muted border-border">
                              {ACTION_TYPE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  <div>
                                    <span>{opt.label}</span>
                                    <span className="text-muted-foreground text-[11px] ml-2">
                                      {opt.description}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEdit}
                            className="text-muted-foreground hover:text-white"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(cat)}
                            className="bg-primary hover:bg-primary/90 text-black"
                          >
                            <Save className="w-3.5 h-3.5 mr-1.5" />
                            Save
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={cat.id}
                      className={`p-4 rounded-lg border transition-all ${
                        cat.enabled
                          ? "border-border bg-background/30"
                          : "border-border bg-background/10 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div
                            className={`p-2 rounded-lg ${cc.bg} ${cc.border} border flex-shrink-0`}
                          >
                            <CategoryIcon
                              name={cat.icon}
                              className={`w-4 h-4 ${cc.text}`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-medium text-foreground">
                                {cat.name}
                              </p>
                              {cat.is_built_in && (
                                <Lock className="w-3 h-3 text-muted-foreground" />
                              )}
                              <Badge
                                variant={actionBadge.variant}
                                className="text-[10px] px-1.5 py-0"
                              >
                                {actionBadge.label}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 font-mono">
                              {cat.slug}
                            </p>
                            {cat.description && (
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {cat.description}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!searchQuery.trim() && (
                            <div className="flex flex-col">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-muted-foreground hover:text-white"
                                onClick={() => handleReorder(cat, "up")}
                                disabled={filteredCategories.indexOf(cat) === 0}
                                title="Move up"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-muted-foreground hover:text-white"
                                onClick={() => handleReorder(cat, "down")}
                                disabled={
                                  filteredCategories.indexOf(cat) ===
                                  filteredCategories.length - 1
                                }
                                title="Move down"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                          <Switch
                            checked={cat.enabled}
                            onCheckedChange={() => handleToggleEnabled(cat)}
                            disabled={togglingId === cat.id}
                          />
                          {!cat.is_built_in && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-white"
                                onClick={() => startEdit(cat)}
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                onClick={() => setDeletingId(cat.id)}
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <DialogContent className="bg-muted border-border">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Category</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete this custom category? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeletingId(null)}
              className="text-muted-foreground hover:text-white"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent className="bg-muted border-border">
          <DialogHeader>
            <DialogTitle className="text-white">Reset to Defaults</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will delete all custom categories and restore the 13 built-in
              defaults. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowResetDialog(false)}
              className="text-muted-foreground hover:text-white"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={isResetting}
            >
              {isResetting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RotateCcw className="w-4 h-4 mr-2" />
              )}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
