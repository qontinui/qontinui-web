"use client";

import {
  mockWorkflows,
  mockStates,
  mockImages,
  mockTransitions,
  mockFolders,
} from "./demo-mock-data";

interface StatCardProps {
  count: number;
  label: string;
}

function StatCard({ count, label }: StatCardProps) {
  return (
    <div className="p-6 border rounded-lg bg-card">
      <div className="text-3xl font-bold text-primary">{count}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

export function DemoStatsGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <StatCard count={mockWorkflows.length} label="Workflows" />
      <StatCard count={mockStates.length} label="States" />
      <StatCard count={mockImages.length} label="Images" />
      <StatCard count={mockTransitions.length} label="Transitions" />
      <StatCard count={mockFolders.length} label="Folders" />
    </div>
  );
}
