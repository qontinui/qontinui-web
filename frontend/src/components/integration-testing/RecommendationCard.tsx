// components/integration-testing/RecommendationCard.tsx

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CheckCircle2,
  Image as ImageIcon,
  Activity,
  Clock,
  Info,
  Star,
} from 'lucide-react';
import type { SnapshotRecommendation } from '@/types/snapshot-recommendations';

interface RecommendationCardProps {
  recommendation: SnapshotRecommendation;
  isSelected?: boolean;
  onSelect: () => void;
  onViewDetails?: (snapshotId: number) => void;
}

export function RecommendationCard({
  recommendation,
  isSelected = false,
  onSelect,
  onViewDetails,
}: RecommendationCardProps) {
  const { snapshots, score, reason, coverage, estimated_execution_time_seconds, rank } = recommendation;

  const stateCoveragePercent = (coverage.state_coverage.covered_states / coverage.state_coverage.total_states) * 100;
  const actionCoveragePercent = (coverage.action_coverage.covered_action_types / coverage.action_coverage.total_action_types) * 100;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-orange-600';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-50 border-green-200';
    if (score >= 60) return 'bg-yellow-50 border-yellow-200';
    return 'bg-orange-50 border-orange-200';
  };

  return (
    <Card
      className={`
        transition-all cursor-pointer
        ${isSelected
          ? 'ring-2 ring-blue-500 bg-blue-50/50 shadow-md'
          : 'hover:shadow-md hover:border-gray-300'
        }
      `}
      onClick={onSelect}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">
                Combination {rank}
              </CardTitle>
              {rank === 1 && (
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              )}
            </div>
            <p className="text-sm text-gray-600 mt-1">{reason}</p>
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`px-3 py-2 rounded-lg border ${getScoreBgColor(score)}`}>
                  <div className={`text-2xl font-bold ${getScoreColor(score)}`}>
                    {Math.round(score)}
                  </div>
                  <div className="text-xs text-gray-600">score</div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Recommendation score (0-100)</p>
                <p className="text-xs text-gray-300 mt-1">Based on coverage, recency, and efficiency</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Snapshots Included */}
        <div>
          <div className="text-xs font-medium text-gray-700 mb-2">
            Snapshots Included ({snapshots.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {snapshots.map((snapshot) => (
              <TooltipProvider key={snapshot.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-gray-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewDetails?.(snapshot.id);
                      }}
                    >
                      {snapshot.run_id.substring(0, 8)}...
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{snapshot.run_id}</p>
                    <p className="text-xs text-gray-300 mt-1">
                      {snapshot.total_actions} actions, {snapshot.total_screenshots} screenshots
                    </p>
                    <p className="text-xs text-gray-400">Click to view details</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>

        {/* Coverage Metrics */}
        <div className="space-y-3">
          {/* State Coverage */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-gray-700">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>State Coverage</span>
                      <Info className="w-3 h-3 text-gray-400" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Number of unique application states covered</p>
                    <p className="text-xs text-gray-300 mt-1">
                      {coverage.state_coverage.covered_states} of {coverage.state_coverage.total_states} states
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="font-medium">
                {coverage.state_coverage.covered_states}/{coverage.state_coverage.total_states}
              </span>
            </div>
            <Progress value={stateCoveragePercent} className="h-2" />
          </div>

          {/* Action Type Coverage */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-gray-700">
                      <Activity className="w-3 h-3" />
                      <span>Action Coverage</span>
                      <Info className="w-3 h-3 text-gray-400" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Variety of action types included</p>
                    <p className="text-xs text-gray-300 mt-1">
                      {coverage.action_coverage.covered_action_types} of {coverage.action_coverage.total_action_types} types
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="font-medium">
                {coverage.action_coverage.covered_action_types}/{coverage.action_coverage.total_action_types}
              </span>
            </div>
            <Progress value={actionCoveragePercent} className="h-2" />
          </div>

          {/* Additional Metrics */}
          <div className="flex items-center justify-between pt-2 border-t">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <ImageIcon className="w-3 h-3" />
                    <span>{coverage.screenshot_count} screenshots</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Total screenshots in this combination</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <Clock className="w-3 h-3" />
                    <span>~{Math.round(estimated_execution_time_seconds)}s</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Estimated execution time</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Action Button */}
        <Button
          className="w-full"
          variant={isSelected ? 'default' : 'outline'}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
        >
          {isSelected ? 'Selected' : 'Use This Combination'}
        </Button>
      </CardContent>
    </Card>
  );
}
