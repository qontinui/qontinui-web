/**
 * AnnotationEditor
 *
 * Shows annotation coverage dashboard and provides inline editing
 * for element annotations. Changes are saved via PUT to UI Bridge.
 */

import { useState, useMemo, useCallback } from "react";
import { Save, X, Plus, Tag, BarChart3 } from "lucide-react";

export interface AnnotationData {
  elementId: string;
  description: string;
  purpose: string;
  notes: string;
  tags: string[];
  relatedElements: string[];
}

interface AnnotationEditorProps {
  elements: Array<{ id: string; label: string; type: string }>;
  annotations: Map<string, AnnotationData>;
  onSave: (annotation: AnnotationData) => Promise<void>;
  isSaving: boolean;
}

export function AnnotationEditor({
  elements,
  annotations,
  onSave,
  isSaving,
}: AnnotationEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AnnotationData>({
    elementId: "",
    description: "",
    purpose: "",
    notes: "",
    tags: [],
    relatedElements: [],
  });
  const [newTag, setNewTag] = useState("");

  const annotatedCount = annotations.size;
  const totalCount = elements.length;
  const coveragePercent =
    totalCount > 0 ? Math.round((annotatedCount / totalCount) * 100) : 0;

  const unannotated = useMemo(
    () => elements.filter((e) => !annotations.has(e.id)),
    [elements, annotations]
  );
  const annotated = useMemo(
    () => elements.filter((e) => annotations.has(e.id)),
    [elements, annotations]
  );

  const startEdit = useCallback(
    (elementId: string) => {
      const existing = annotations.get(elementId);
      setEditForm(
        existing || {
          elementId,
          description: "",
          purpose: "",
          notes: "",
          tags: [],
          relatedElements: [],
        }
      );
      setEditingId(elementId);
    },
    [annotations]
  );

  const handleSave = async () => {
    await onSave(editForm);
    setEditingId(null);
  };

  const addTag = () => {
    if (newTag.trim() && !editForm.tags.includes(newTag.trim())) {
      setEditForm({ ...editForm, tags: [...editForm.tags, newTag.trim()] });
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setEditForm({ ...editForm, tags: editForm.tags.filter((t) => t !== tag) });
  };

  return (
    <div className="h-full overflow-auto">
      {/* Coverage dashboard */}
      <div className="p-4 border-b border-neutral-700">
        <div className="flex items-center gap-3 mb-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-neutral-200">Coverage</span>
          <span className="text-sm text-neutral-400">
            {coveragePercent}% annotated ({annotatedCount}/{totalCount} elements)
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-2 bg-neutral-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-300"
            style={{ width: `${coveragePercent}%` }}
          />
        </div>
      </div>

      {/* Inline editor (if editing) */}
      {editingId && (
        <div className="p-4 border-b border-neutral-700 bg-neutral-800/50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-neutral-200">
              Editing:{" "}
              {elements.find((e) => e.id === editingId)?.label || editingId}
            </h4>
            <button
              onClick={() => setEditingId(null)}
              className="text-neutral-400 hover:text-neutral-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Description
              </label>
              <input
                type="text"
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                placeholder="What is this element?"
                className="w-full px-3 py-1.5 text-sm bg-neutral-900 border border-neutral-600 rounded-md text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Purpose
              </label>
              <input
                type="text"
                value={editForm.purpose}
                onChange={(e) =>
                  setEditForm({ ...editForm, purpose: e.target.value })
                }
                placeholder="What role does it play in the UI?"
                className="w-full px-3 py-1.5 text-sm bg-neutral-900 border border-neutral-600 rounded-md text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Notes
              </label>
              <textarea
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm({ ...editForm, notes: e.target.value })
                }
                placeholder="Any additional notes..."
                rows={2}
                className="w-full px-3 py-1.5 text-sm bg-neutral-900 border border-neutral-600 rounded-md text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Tags
              </label>
              <div className="flex flex-wrap gap-1 mb-2">
                {editForm.tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-red-400"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && (e.preventDefault(), addTag())
                  }
                  placeholder="Add tag..."
                  className="flex-1 px-2 py-1 text-xs bg-neutral-900 border border-neutral-600 rounded text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={addTag}
                  className="px-2 py-1 text-xs bg-neutral-700 text-neutral-300 rounded hover:bg-neutral-600"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {isSaving ? "Saving..." : "Save Annotation"}
            </button>
          </div>
        </div>
      )}

      {/* Unannotated elements */}
      <div className="p-4 border-b border-neutral-700/50">
        <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-2">
          Unannotated ({unannotated.length})
        </h4>
        <div className="flex flex-wrap gap-1">
          {unannotated.map((el) => (
            <button
              key={el.id}
              onClick={() => startEdit(el.id)}
              className="px-2 py-1 text-xs bg-neutral-800 text-neutral-300 rounded hover:bg-neutral-700 transition-colors"
            >
              {el.label} <span className="text-neutral-500">({el.type})</span>
            </button>
          ))}
          {unannotated.length === 0 && (
            <p className="text-xs text-emerald-400">
              All elements are annotated!
            </p>
          )}
        </div>
      </div>

      {/* Annotated elements */}
      <div className="p-4">
        <h4 className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-2">
          Annotated ({annotated.length})
        </h4>
        <div className="space-y-1">
          {annotated.map((el) => {
            const ann = annotations.get(el.id);
            return (
              <div
                key={el.id}
                className="flex items-center gap-2 px-3 py-2 bg-neutral-800/30 rounded hover:bg-neutral-800/50"
              >
                <Tag className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                <span className="text-xs font-medium text-neutral-200">
                  {el.label}:
                </span>
                <span className="text-xs text-neutral-400 truncate flex-1">
                  {ann?.description || "No description"}
                </span>
                <button
                  onClick={() => startEdit(el.id)}
                  className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0"
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
