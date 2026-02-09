"use client";

import { useState } from "react";
import type { ExternalElement } from "@/hooks/use-external-ui-bridge";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";

function DetailField({
  label,
  value,
  mono,
  badge,
}: {
  label: string;
  value: string;
  mono?: boolean;
  badge?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-text-muted uppercase tracking-wider mb-1">
        {label}
      </p>
      {badge ? (
        <Badge variant="secondary">{value}</Badge>
      ) : (
        <p
          className={`text-sm text-text-primary ${mono ? "font-mono bg-surface-canvas/50 rounded p-2" : ""}`}
        >
          {value}
        </p>
      )}
    </div>
  );
}

export function ElementDetails({ element }: { element: ExternalElement }) {
  const [showRawJson, setShowRawJson] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <DetailField label="ID" value={element.id} mono />
        {element.type && <DetailField label="Type" value={element.type} />}
        {element.tagName && (
          <DetailField label="Tag" value={element.tagName} badge />
        )}
        {element.role && (
          <DetailField label="Role" value={element.role} badge />
        )}
        {element.text && <DetailField label="Text" value={element.text} />}
        {element.label && <DetailField label="Label" value={element.label} />}
        {element.accessibleName && (
          <DetailField label="Accessible Name" value={element.accessibleName} />
        )}

        <div className="flex gap-3">
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider mb-1">
              Interactive
            </p>
            <Badge
              variant={
                element.is_interactive || element.interactive
                  ? "success"
                  : "secondary"
              }
            >
              {element.is_interactive || element.interactive ? "Yes" : "No"}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider mb-1">
              Visible
            </p>
            <Badge
              variant={element.visible !== false ? "success" : "secondary"}
            >
              {element.visible !== false ? "Yes" : "No"}
            </Badge>
          </div>
          {element.enabled !== undefined && (
            <div>
              <p className="text-xs text-text-muted uppercase tracking-wider mb-1">
                Enabled
              </p>
              <Badge
                variant={element.enabled !== false ? "success" : "secondary"}
              >
                {element.enabled !== false ? "Yes" : "No"}
              </Badge>
            </div>
          )}
        </div>

        {element.bounds && (
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider mb-1">
              Bounding Rect
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono text-text-muted bg-surface-canvas/50 rounded p-2">
              <span>x: {element.bounds.x}</span>
              <span>y: {element.bounds.y}</span>
              <span>w: {element.bounds.width}</span>
              <span>h: {element.bounds.height}</span>
            </div>
          </div>
        )}

        {element.actions && element.actions.length > 0 && (
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider mb-1">
              Available Actions
            </p>
            <div className="flex flex-wrap gap-1">
              {element.actions.map((action) => (
                <Badge key={action} variant="outline" className="text-[10px]">
                  {action}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => setShowRawJson(!showRawJson)}
        className="text-xs text-text-muted cursor-pointer hover:text-text-secondary flex items-center gap-1"
      >
        <ChevronRight
          className={`w-3 h-3 transition-transform ${showRawJson ? "rotate-90" : ""}`}
        />
        Raw JSON
      </button>
      {showRawJson && (
        <pre className="text-xs text-text-muted bg-surface-canvas/80 rounded p-3 overflow-x-auto max-h-[200px] overflow-y-auto">
          {JSON.stringify(element, null, 2)}
        </pre>
      )}
    </div>
  );
}
