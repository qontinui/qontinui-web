"use client";

import { useState } from "react";
import type { GlobalLogSourceProfile } from "@/lib/runner-api";
import { X } from "lucide-react";
import type { ProfileEditorProps } from "../log-sources-types";

export function ProfileEditor({
  profile,
  sources,
  onSave,
  onCancel,
}: ProfileEditorProps) {
  const [form, setForm] = useState({
    name: profile?.name || "",
    description: profile?.description || "",
    source_ids: profile?.source_ids || ([] as string[]),
  });

  const toggleSource = (id: string) => {
    setForm((f) => ({
      ...f,
      source_ids: f.source_ids.includes(id)
        ? f.source_ids.filter((sid) => sid !== id)
        : [...f.source_ids, id],
    }));
  };

  const selectByCategory = (category: string) => {
    const categorySourceIds = sources
      .filter((s) => s.category === category)
      .map((s) => s.id);
    setForm((f) => ({
      ...f,
      source_ids: [...new Set([...f.source_ids, ...categorySourceIds])],
    }));
  };

  const handleSubmit = () => {
    if (!form.name) return;

    const data = {
      ...(profile ? { id: profile.id, created_at: profile.created_at } : {}),
      name: form.name,
      description: form.description || undefined,
      source_ids: form.source_ids,
    };

    onSave(data as GlobalLogSourceProfile);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-muted rounded-lg shadow-xl w-full max-w-md p-4 space-y-4 max-h-[80vh] overflow-y-auto border border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-white">
            {profile ? "Edit Profile" : "Add Profile"}
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
              htmlFor="lsp-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Name *
            </label>
            <input
              id="lsp-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Web Development"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <label
              htmlFor="lsp-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <input
              id="lsp-description"
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Sources for web frontend and backend development"
              className="w-full mt-1 px-2.5 py-1.5 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/50 text-white placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">
                Sources
              </p>
              <div className="flex gap-1">
                {["frontend", "backend", "mobile"].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => selectByCategory(cat)}
                    className="px-1.5 py-0.5 text-[10px] bg-background hover:bg-background/80 rounded capitalize text-muted-foreground"
                  >
                    + {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {sources.map((source) => (
                <label
                  key={source.id}
                  className="flex items-center gap-2 p-1.5 rounded hover:bg-background/30 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={form.source_ids.includes(source.id)}
                    onChange={() => toggleSource(source.id)}
                    className="w-4 h-4 accent-brand-primary"
                  />
                  <span className="text-sm text-white">{source.name}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">
                    ({source.category})
                  </span>
                </label>
              ))}
            </div>
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
            disabled={!form.name}
            className="px-3 py-1.5 text-sm bg-primary text-black font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {profile ? "Update" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
