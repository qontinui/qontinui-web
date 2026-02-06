/**
 * TestSpecAssertionRow
 *
 * A single assertion row within a test specification.
 * Shows enable/disable toggle, description, severity, and review status.
 */

import { Check, X, MessageSquare } from "lucide-react";
import type { SpecAssertion } from "../types";
import { SEVERITY_COLORS } from "../types";

interface TestSpecAssertionRowProps {
  assertion: SpecAssertion;
  onToggle: (id: string) => void;
  onReview: (id: string) => void;
  onEditNotes?: (id: string, notes: string) => void;
}

export function TestSpecAssertionRow({
  assertion,
  onToggle,
  onReview,
}: TestSpecAssertionRowProps) {
  const severityColor = SEVERITY_COLORS[assertion.severity];

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${
        assertion.enabled
          ? "bg-neutral-800/50 hover:bg-neutral-800"
          : "bg-neutral-900/30 opacity-50"
      }`}
    >
      {/* Enable/disable checkbox */}
      <button
        onClick={() => onToggle(assertion.id)}
        className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
          assertion.enabled
            ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
            : "border-neutral-600 bg-neutral-800 text-neutral-600"
        }`}
      >
        {assertion.enabled && <Check className="w-3 h-3" />}
      </button>

      {/* Description */}
      <span
        className={`flex-1 text-sm ${assertion.enabled ? "text-neutral-200" : "text-neutral-500"}`}
      >
        {assertion.description}
      </span>

      {/* Source badge */}
      {assertion.source === "manual" && (
        <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
          manual
        </span>
      )}

      {/* Severity badge */}
      <span className={`text-xs font-medium ${severityColor}`}>
        {assertion.severity}
      </span>

      {/* Review status */}
      <button
        onClick={() => onReview(assertion.id)}
        className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors ${
          assertion.reviewed
            ? "text-emerald-400 hover:text-emerald-300"
            : "text-neutral-600 hover:text-neutral-400"
        }`}
        title={assertion.reviewed ? "Reviewed" : "Mark as reviewed"}
      >
        {assertion.reviewed ? (
          <Check className="w-3 h-3" />
        ) : (
          <X className="w-3 h-3" />
        )}
      </button>

      {/* Notes indicator */}
      {assertion.notes && (
        <MessageSquare className="w-3 h-3 text-yellow-400 flex-shrink-0" />
      )}
    </div>
  );
}
