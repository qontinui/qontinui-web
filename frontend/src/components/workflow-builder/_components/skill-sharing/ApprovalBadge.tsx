import React from "react";

export function ApprovalBadge({ status }: { status: string }) {
  const colorClass =
    status === "approved"
      ? "bg-green-900/30 text-green-400"
      : status === "rejected"
        ? "bg-red-900/30 text-red-400"
        : "bg-yellow-900/30 text-yellow-400";

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${colorClass}`}>
      {status}
    </span>
  );
}
