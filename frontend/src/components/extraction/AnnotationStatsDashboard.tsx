/**
 * Annotation Statistics Dashboard
 *
 * Displays comprehensive statistics about annotation data including:
 * - Summary cards (total elements, ground truth, review status, auto-detected vs manual)
 * - Element type distribution chart (inline SVG pie chart)
 * - Progress indicators (annotation progress, ground truth coverage)
 * - Recent activity (last modified, version count)
 */

"use client";

import { useMemo } from "react";
import {
  Layers,
  CheckCircle2,
  ClipboardCheck,
  Zap,
  Clock,
  History,
} from "lucide-react";
import { useExtractionAnnotationStore, type ReviewStatus } from "@/stores/extraction-annotation-store";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: string;
}

function StatCard({ title, value, subtitle, icon, color = "#9B59B6" }: StatCardProps) {
  return (
    <div className="bg-surface-raised rounded-lg border border-border-subtle p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="p-2 rounded-md"
            style={{ backgroundColor: `${color}20` }}
          >
            <div style={{ color }}>{icon}</div>
          </div>
          <span className="text-sm text-text-muted">{title}</span>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-2xl font-semibold text-text-primary">{value}</div>
        {subtitle && (
          <div className="text-xs text-text-muted mt-1">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

interface ProgressBarProps {
  label: string;
  value: number;
  total: number;
  color?: string;
}

function ProgressBar({ label, value, total, color = "#9B59B6" }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="text-sm font-medium text-text-primary">
          {value}/{total} ({percentage}%)
        </span>
      </div>
      <div className="h-2 bg-surface-base rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

interface PieChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
}

function PieChart({ data, size = 120 }: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center text-text-muted text-sm"
        style={{ width: size, height: size }}
      >
        No data
      </div>
    );
  }

  // Calculate pie slices
  let cumulativeAngle = 0;
  const slices = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const angle = (d.value / total) * 360;
      const startAngle = cumulativeAngle;
      cumulativeAngle += angle;
      return {
        ...d,
        startAngle,
        endAngle: cumulativeAngle,
        percentage: Math.round((d.value / total) * 100),
      };
    });

  const center = size / 2;
  const radius = (size / 2) - 10;

  // Convert polar coordinates to cartesian
  const polarToCartesian = (angle: number) => {
    const radians = ((angle - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(radians),
      y: center + radius * Math.sin(radians),
    };
  };

  // Create SVG path for a pie slice
  const createSlicePath = (startAngle: number, endAngle: number) => {
    const start = polarToCartesian(startAngle);
    const end = polarToCartesian(endAngle);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

    return [
      `M ${center} ${center}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
      "Z",
    ].join(" ");
  };

  return (
    <svg width={size} height={size} className="overflow-visible">
      {slices.map((slice, index) => (
        <path
          key={index}
          d={createSlicePath(slice.startAngle, slice.endAngle)}
          fill={slice.color}
          stroke="var(--color-surface-raised)"
          strokeWidth="2"
          className="transition-opacity hover:opacity-80"
        >
          <title>
            {slice.label}: {slice.value} ({slice.percentage}%)
          </title>
        </path>
      ))}
    </svg>
  );
}

interface AnnotationStatsDashboardProps {
  className?: string;
}

export function AnnotationStatsDashboard({ className }: AnnotationStatsDashboardProps) {
  const { elements, versions, lastSavedAt } = useExtractionAnnotationStore();

  // Calculate statistics
  const stats = useMemo(() => {
    const total = elements.length;
    const groundTruth = elements.filter((el) => el.isGroundTruth).length;
    const autoDetected = elements.filter((el) => el.isAutoDetected).length;
    const manual = total - autoDetected;

    // Review status breakdown
    const reviewCounts: Record<ReviewStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      needs_revision: 0,
    };

    elements.forEach((el) => {
      const status = el.reviewStatus || "pending";
      reviewCounts[status]++;
    });

    // Element type distribution
    const typeCounts: Record<string, number> = {};
    elements.forEach((el) => {
      const type = el.elementType || "unknown";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    // Sort by count descending
    const sortedTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8); // Top 8 types

    return {
      total,
      groundTruth,
      groundTruthPercentage: total > 0 ? Math.round((groundTruth / total) * 100) : 0,
      autoDetected,
      manual,
      reviewCounts,
      approved: reviewCounts.approved,
      pending: reviewCounts.pending,
      rejected: reviewCounts.rejected,
      needsRevision: reviewCounts.needs_revision,
      typeCounts: sortedTypes,
    };
  }, [elements]);

  // Element type colors
  const typeColors: Record<string, string> = {
    button: "#9B59B6",
    input: "#3498DB",
    link: "#2ECC71",
    text: "#F39C12",
    image: "#E74C3C",
    checkbox: "#1ABC9C",
    dropdown: "#9B59B6",
    icon: "#95A5A6",
    unknown: "#7F8C8D",
  };

  const getTypeColor = (type: string): string => {
    const lowerType = type.toLowerCase();
    if (lowerType in typeColors) {
      return typeColors[lowerType] as string;
    }
    return "#7F8C8D"; // unknown type default color
  };

  // Chart data for element types
  const chartData = stats.typeCounts.map(([label, value]) => ({
    label: label.charAt(0).toUpperCase() + label.slice(1),
    value,
    color: getTypeColor(label),
  }));

  // Format last saved time
  const formatLastSaved = () => {
    if (!lastSavedAt) return "Never";
    const date = new Date(lastSavedAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Elements"
          value={stats.total}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          title="Ground Truth"
          value={stats.groundTruth}
          subtitle={`${stats.groundTruthPercentage}% of total`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="#2ECC71"
        />
        <StatCard
          title="Approved"
          value={stats.approved}
          subtitle={`${stats.pending} pending, ${stats.rejected} rejected`}
          icon={<ClipboardCheck className="h-4 w-4" />}
          color="#3498DB"
        />
        <StatCard
          title="Auto-Detected"
          value={stats.autoDetected}
          subtitle={`${stats.manual} manual`}
          icon={<Zap className="h-4 w-4" />}
          color="#F39C12"
        />
      </div>

      {/* Charts and Progress Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Element Type Distribution */}
        <div className="bg-surface-raised rounded-lg border border-border-subtle p-4">
          <h3 className="text-sm font-medium text-text-primary mb-4">
            Element Type Distribution
          </h3>
          <div className="flex items-start gap-6">
            <PieChart data={chartData} size={120} />
            <div className="flex-1 space-y-2">
              {chartData.map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-sm text-text-muted">{label}</span>
                  </div>
                  <span className="text-sm font-medium text-text-primary">
                    {value}
                  </span>
                </div>
              ))}
              {chartData.length === 0 && (
                <div className="text-sm text-text-muted">
                  No elements to display
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress Indicators */}
        <div className="bg-surface-raised rounded-lg border border-border-subtle p-4">
          <h3 className="text-sm font-medium text-text-primary mb-4">
            Progress Indicators
          </h3>
          <div className="space-y-4">
            <ProgressBar
              label="Annotation Progress"
              value={stats.approved}
              total={stats.total}
              color="#9B59B6"
            />
            <ProgressBar
              label="Ground Truth Coverage"
              value={stats.groundTruth}
              total={stats.total}
              color="#2ECC71"
            />
          </div>

          {/* Review Status Breakdown */}
          <div className="mt-6">
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">
              Review Status Breakdown
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-2 rounded-md bg-surface-base">
                <span className="text-xs text-text-muted">Pending</span>
                <span className="text-sm font-medium text-yellow-500">
                  {stats.pending}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-surface-base">
                <span className="text-xs text-text-muted">Approved</span>
                <span className="text-sm font-medium text-green-500">
                  {stats.approved}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-surface-base">
                <span className="text-xs text-text-muted">Rejected</span>
                <span className="text-sm font-medium text-red-500">
                  {stats.rejected}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-surface-base">
                <span className="text-xs text-text-muted">Needs Revision</span>
                <span className="text-sm font-medium text-orange-500">
                  {stats.needsRevision}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-surface-raised rounded-lg border border-border-subtle p-4">
        <h3 className="text-sm font-medium text-text-primary mb-4">
          Recent Activity
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-[#9B59B6]/20">
              <Clock className="h-4 w-4 text-[#9B59B6]" />
            </div>
            <div>
              <div className="text-xs text-text-muted">Last Modified</div>
              <div className="text-sm font-medium text-text-primary">
                {formatLastSaved()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-[#9B59B6]/20">
              <History className="h-4 w-4 text-[#9B59B6]" />
            </div>
            <div>
              <div className="text-xs text-text-muted">Version Count</div>
              <div className="text-sm font-medium text-text-primary">
                {versions.length} version{versions.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
