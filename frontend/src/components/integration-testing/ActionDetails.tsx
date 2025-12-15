// components/integration-testing/ActionDetails.tsx

import { Card } from "@/components/ui/card";
import type { ActionVisualization } from "@/types/integration-testing";

interface ActionDetailsProps {
  action: ActionVisualization;
}

export function ActionDetails({ action }: ActionDetailsProps) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Action Details</h3>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500">Type</dt>
          <dd className="font-medium">{action.action_type}</dd>
        </div>

        <div>
          <dt className="text-gray-500">Duration</dt>
          <dd className="font-medium">{Math.round(action.duration_ms)}ms</dd>
        </div>

        {action.action_location && (
          <div>
            <dt className="text-gray-500">Location</dt>
            <dd className="font-medium">
              ({action.action_location[0]}, {action.action_location[1]})
            </dd>
          </div>
        )}

        {action.action_region && (
          <div>
            <dt className="text-gray-500">Region</dt>
            <dd className="font-medium font-mono text-xs">
              ({action.action_region.x}, {action.action_region.y}){" "}
              {action.action_region.w}×{action.action_region.h}
            </dd>
          </div>
        )}

        {action.text && (
          <div className="col-span-2">
            <dt className="text-gray-500">Text</dt>
            <dd className="font-medium font-mono">{action.text}</dd>
          </div>
        )}

        {action.action_type === "SCROLL" && (action as unknown).direction && (
          <>
            <div>
              <dt className="text-gray-500">Direction</dt>
              <dd className="font-medium">{(action as unknown).direction}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Amount</dt>
              <dd className="font-medium">
                {(action as unknown).amount || 1}{" "}
                {((action as unknown).amount || 1) === 1 ? "unit" : "units"}
              </dd>
            </div>
          </>
        )}

        {action.action_type === "WAIT" && (
          <div>
            <dt className="text-gray-500">Wait Duration</dt>
            <dd className="font-medium">
              {action.duration_ms >= 1000
                ? `${(action.duration_ms / 1000).toFixed(1)}s`
                : `${action.duration_ms}ms`}
            </dd>
          </div>
        )}

        {(action.action_type === "DEFINE" || action.action_type === "VANISH") &&
          (action as unknown).state_name && (
            <div className="col-span-2">
              <dt className="text-gray-500">State Name</dt>
              <dd className="font-medium">{(action as unknown).state_name}</dd>
            </div>
          )}

        {action.matches && action.matches.length > 0 && (
          <div className="col-span-2">
            <dt className="text-gray-500">Matches ({action.matches.length})</dt>
            <dd className="space-y-1 mt-1">
              {action.matches.map((match, i) => (
                <div key={i} className="text-xs font-mono">
                  [{i}] ({match.x}, {match.y}) {match.w}×{match.h} -{" "}
                  {Math.round(match.score * 100)}%
                </div>
              ))}
            </dd>
          </div>
        )}

        <div className="col-span-2">
          <dt className="text-gray-500">
            Active States ({action.active_states.length})
          </dt>
          <dd className="flex flex-wrap gap-1 mt-1">
            {action.active_states.map((state) => (
              <span
                key={state}
                className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
              >
                {state}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
