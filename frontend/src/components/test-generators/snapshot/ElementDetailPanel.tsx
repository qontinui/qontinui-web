/**
 * ElementDetailPanel
 *
 * Right column of the Elements tab. Shows detailed information about
 * the selected element including state, actions, and annotation preview.
 */

import { Edit } from "lucide-react";

export interface ElementDetail {
  id: string;
  type: string;
  label: string;
  role?: string;
  ariaLabel?: string;
  isVisible: boolean;
  isEnabled: boolean;
  isInteractive: boolean;
  value?: string;
  checked?: boolean;
  actions: string[];
  annotation?: {
    description?: string;
    purpose?: string;
    notes?: string;
    tags?: string[];
  };
  attributes?: Record<string, string>;
}

interface ElementDetailPanelProps {
  element: ElementDetail | null;
  onEditAnnotation?: (elementId: string) => void;
}

export function ElementDetailPanel({
  element,
  onEditAnnotation,
}: ElementDetailPanelProps) {
  if (!element) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm" data-ui-element>
        Select an element to view details
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-neutral-100">
          {element.label}
        </h3>
        <p className="text-xs text-neutral-500 font-mono mt-1">{element.id}</p>
      </div>

      {/* Type & Role */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 bg-neutral-800 rounded">
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
            Type
          </p>
          <p className="text-xs text-neutral-200">{element.type}</p>
        </div>
        {element.role && (
          <div className="p-2 bg-neutral-800 rounded">
            <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
              Role
            </p>
            <p className="text-xs text-neutral-200">{element.role}</p>
          </div>
        )}
        {element.ariaLabel && (
          <div className="p-2 bg-neutral-800 rounded col-span-2">
            <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
              ARIA Label
            </p>
            <p className="text-xs text-neutral-200">{element.ariaLabel}</p>
          </div>
        )}
      </div>

      {/* State */}
      <div>
        <p className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">
          State
        </p>
        <div className="flex flex-wrap gap-2">
          <span
            className={`px-2 py-0.5 text-[10px] rounded ${element.isVisible ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
          >
            {element.isVisible ? "visible" : "hidden"}
          </span>
          <span
            className={`px-2 py-0.5 text-[10px] rounded ${element.isEnabled ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
          >
            {element.isEnabled ? "enabled" : "disabled"}
          </span>
          {element.isInteractive && (
            <span className="px-2 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-400">
              interactive
            </span>
          )}
          {element.value !== undefined && (
            <span className="px-2 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-400">
              value: {element.value}
            </span>
          )}
          {element.checked !== undefined && (
            <span className="px-2 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-400">
              {element.checked ? "checked" : "unchecked"}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {element.actions.length > 0 && (
        <div>
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">
            Actions
          </p>
          <div className="flex flex-wrap gap-1">
            {element.actions.map((action) => (
              <span
                key={action}
                className="px-2 py-0.5 text-[10px] bg-neutral-700 text-neutral-300 rounded"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Attributes */}
      {element.attributes && Object.keys(element.attributes).length > 0 && (
        <div>
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1">
            Attributes
          </p>
          <div className="space-y-1">
            {Object.entries(element.attributes).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <span className="text-neutral-400 font-mono">{key}:</span>
                <span className="text-neutral-200 truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Annotation preview */}
      <div className="border-t border-neutral-700 pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] text-neutral-500 uppercase tracking-wide">
            Annotation
          </p>
          {onEditAnnotation && (
            <button
              onClick={() => onEditAnnotation(element.id)}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Edit className="w-3 h-3" /> Edit Annotation
            </button>
          )}
        </div>
        {element.annotation ? (
          <div className="space-y-2 p-2 bg-neutral-800/50 rounded">
            {element.annotation.description && (
              <p className="text-xs text-neutral-200">
                {element.annotation.description}
              </p>
            )}
            {element.annotation.purpose && (
              <p className="text-xs text-neutral-400">
                Purpose: {element.annotation.purpose}
              </p>
            )}
            {element.annotation.tags && element.annotation.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {element.annotation.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-neutral-500 italic">No annotation yet</p>
        )}
      </div>
    </div>
  );
}
