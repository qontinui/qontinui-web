import type { StateNodeData } from "../StateCoverageHeatMap.types";

function getNodeStyle(status: StateNodeData["status"]) {
  switch (status) {
    case "passing":
      return "border-green-500 bg-green-500/20 shadow-green-500/50";
    case "partial":
      return "border-yellow-500 bg-yellow-500/20 shadow-yellow-500/50";
    case "failing":
      return "border-red-500 bg-red-500/20 shadow-red-500/50";
    case "uncovered":
      return "border-border-default bg-border-default/10 shadow-border-default/30";
  }
}

function getStatusIcon(status: StateNodeData["status"]) {
  switch (status) {
    case "passing":
      return "\u2713";
    case "partial":
      return "\u26A0";
    case "failing":
      return "\u2717";
    case "uncovered":
      return "\u25CB";
  }
}

function getTextColor(status: StateNodeData["status"]) {
  switch (status) {
    case "passing":
      return "text-green-400";
    case "partial":
      return "text-yellow-400";
    case "failing":
      return "text-red-400";
    case "uncovered":
      return "text-text-muted";
  }
}

export function CoverageStateNode({ data }: { data: StateNodeData }) {
  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 bg-surface-raised ${getNodeStyle(data.status)} min-w-[160px] shadow-lg cursor-pointer hover:scale-105 transition-transform`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-white">{data.label}</div>
        <div
          className={`text-lg font-bold ${getTextColor(data.status)}`}
          title={data.status}
        >
          {getStatusIcon(data.status)}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">
          {data.covered ? `${data.visit_count} visits` : "Not tested"}
        </span>
        {data.covered && (
          <span className={getTextColor(data.status)}>
            {data.success_rate.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

export const coverageNodeTypes = {
  coverageStateNode: CoverageStateNode,
};
