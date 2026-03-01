"use client";

import { useState } from "react";
import type { LogSourceCategory } from "@/lib/runner-api";
import { X, FolderOpen, ChevronDown, ChevronRight } from "lucide-react";
import { CATEGORIES } from "../log-sources-utils";
import type { SourceEditorProps } from "../log-sources-types";

export function SourceEditor({ source, onSave, onCancel }: SourceEditorProps) {
  const [form, setForm] = useState({
    name: source?.name || "",
    description: source?.description || "",
    category: source?.category || ("general" as LogSourceCategory),
    type: source?.type || "file",
    path: source?.path || "",
    pattern: source?.pattern || "",
    tail_lines: source?.tail_lines || 100,
    color: source?.color || "",
    keywords: source?.keywords?.join(", ") || "",
    format: source?.format || "plaintext",
    parser: source?.parser || "generic",
    timestamp_pattern: source?.timestamp_pattern || "",
    timezone: source?.timezone || "local",
    error_patterns: source?.error_patterns?.join("\n") || "",
    warning_patterns: source?.warning_patterns?.join("\n") || "",
    ignore_patterns: source?.ignore_patterns?.join("\n") || "",
    poll_interval_ms: source?.poll_interval_ms || 5000,
  });
  const [showErrorMonitoring, setShowErrorMonitoring] = useState(false);

  const handleSubmit = () => {
    if (!form.name || !form.path) return;

    const baseData = {
      name: form.name,
      description: form.description,
      category: form.category as LogSourceCategory,
      type: form.type,
      path: form.path,
      pattern: form.pattern || undefined,
      tail_lines: form.tail_lines,
      enabled: source?.enabled ?? true,
      color: form.color || undefined,
      keywords: form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      format: form.format,
      parser: form.parser,
      timestamp_pattern: form.timestamp_pattern || undefined,
      timezone: form.timezone,
      error_patterns: form.error_patterns
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      warning_patterns: form.warning_patterns
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      ignore_patterns: form.ignore_patterns
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      poll_interval_ms: form.poll_interval_ms,
    };

    if (source) {
      onSave({ ...baseData, id: source.id } as Parameters<typeof onSave>[0]);
    } else {
      onSave(baseData as Parameters<typeof onSave>[0]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-muted rounded-lg shadow-xl w-full max-w-md p-4 space-y-4 max-h-[85vh] overflow-y-auto border border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-white">
            {source ? "Edit Source" : "Add Source"}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-background rounded text-muted-foreground hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label
              htmlFor="ls-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Name *
            </label>
            <input
              id="ls-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Backend Logs"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <label
              htmlFor="ls-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <input
              id="ls-description"
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="FastAPI backend server logs"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="ls-category"
                className="text-xs font-medium text-muted-foreground"
              >
                Category
              </label>
              <select
                id="ls-category"
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value as LogSourceCategory,
                  }))
                }
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="ls-type"
                className="text-xs font-medium text-muted-foreground"
              >
                Type
              </label>
              <select
                id="ls-type"
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value }))
                }
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
              >
                <option value="file">File</option>
                <option value="directory">Directory</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="ls-path"
              className="text-xs font-medium text-muted-foreground"
            >
              Path *
            </label>
            <div className="flex gap-2 mt-1">
              <input
                id="ls-path"
                type="text"
                value={form.path}
                onChange={(e) =>
                  setForm((f) => ({ ...f, path: e.target.value }))
                }
                placeholder="/path/to/logs/app.log"
                className="flex-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
              />
              <button className="p-2 bg-background border border-border hover:bg-background/80 rounded-md text-muted-foreground">
                <FolderOpen className="w-4 h-4" />
              </button>
            </div>
          </div>

          {form.type === "directory" && (
            <div>
              <label
                htmlFor="ls-pattern"
                className="text-xs font-medium text-muted-foreground"
              >
                Pattern
              </label>
              <input
                id="ls-pattern"
                type="text"
                value={form.pattern}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pattern: e.target.value }))
                }
                placeholder="*.log"
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="ls-tail-lines"
                className="text-xs font-medium text-muted-foreground"
              >
                Tail Lines
              </label>
              <input
                id="ls-tail-lines"
                type="number"
                value={form.tail_lines}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    tail_lines: parseInt(e.target.value) || 100,
                  }))
                }
                min={10}
                max={10000}
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
              />
            </div>
            <div>
              <label
                htmlFor="ls-color"
                className="text-xs font-medium text-muted-foreground"
              >
                Color
              </label>
              <input
                id="ls-color"
                type="text"
                value={form.color}
                onChange={(e) =>
                  setForm((f) => ({ ...f, color: e.target.value }))
                }
                placeholder="#22c55e"
                className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ls-keywords"
              className="text-xs font-medium text-muted-foreground"
            >
              Keywords (comma-separated)
            </label>
            <input
              id="ls-keywords"
              type="text"
              value={form.keywords}
              onChange={(e) =>
                setForm((f) => ({ ...f, keywords: e.target.value }))
              }
              placeholder="python, fastapi, http, api"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Keywords help AI identify when this source is relevant
            </p>
          </div>

          {/* Error Monitoring Section */}
          <div className="border-t border-border pt-3 mt-3">
            <button
              type="button"
              onClick={() => setShowErrorMonitoring(!showErrorMonitoring)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-white"
            >
              {showErrorMonitoring ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              Error Monitoring
            </button>

            {showErrorMonitoring && (
              <div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="ls-format"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Format
                    </label>
                    <select
                      id="ls-format"
                      value={form.format}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, format: e.target.value }))
                      }
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
                    >
                      <option value="plaintext">Plaintext</option>
                      <option value="json">JSON</option>
                      <option value="jsonl">JSONL</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="ls-parser"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Parser
                    </label>
                    <select
                      id="ls-parser"
                      value={form.parser}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, parser: e.target.value }))
                      }
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
                    >
                      <option value="generic">Generic</option>
                      <option value="python">Python</option>
                      <option value="javascript">JavaScript</option>
                      <option value="rust">Rust</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="ls-timestamp-pattern"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Timestamp Pattern
                  </label>
                  <input
                    id="ls-timestamp-pattern"
                    type="text"
                    value={form.timestamp_pattern}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        timestamp_pattern: e.target.value,
                      }))
                    }
                    placeholder={
                      "e.g. ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}"
                    }
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="ls-timezone"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Timezone
                    </label>
                    <input
                      id="ls-timezone"
                      type="text"
                      value={form.timezone}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, timezone: e.target.value }))
                      }
                      placeholder="local"
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="ls-poll-interval"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Poll Interval (ms)
                    </label>
                    <input
                      id="ls-poll-interval"
                      type="number"
                      value={form.poll_interval_ms}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          poll_interval_ms: parseInt(e.target.value) || 5000,
                        }))
                      }
                      min={500}
                      max={60000}
                      className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="ls-error-patterns"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Error Patterns (one per line)
                  </label>
                  <textarea
                    id="ls-error-patterns"
                    value={form.error_patterns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        error_patterns: e.target.value,
                      }))
                    }
                    placeholder="Custom regex patterns to identify errors"
                    rows={3}
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 font-mono text-white placeholder:text-muted-foreground"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ls-warning-patterns"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Warning Patterns (one per line)
                  </label>
                  <textarea
                    id="ls-warning-patterns"
                    value={form.warning_patterns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        warning_patterns: e.target.value,
                      }))
                    }
                    placeholder="Custom regex patterns to identify warnings"
                    rows={2}
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 font-mono text-white placeholder:text-muted-foreground"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ls-ignore-patterns"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Ignore Patterns (one per line)
                  </label>
                  <textarea
                    id="ls-ignore-patterns"
                    value={form.ignore_patterns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        ignore_patterns: e.target.value,
                      }))
                    }
                    placeholder="Patterns to suppress false positives"
                    rows={2}
                    className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 font-mono text-white placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-white hover:bg-background rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.name || !form.path}
            className="px-3 py-1.5 text-sm bg-primary text-black font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {source ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
