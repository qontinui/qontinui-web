// components/integration-testing/CoverageMatrix.tsx

'use client';

import { formatDistanceToNow } from 'date-fns';
import type { StateCoverageMetrics } from '@/types/integration-testing';

interface CoverageMatrixProps {
  stateMetrics: Record<string, StateCoverageMetrics>;
  onStateClick?: (stateName: string) => void;
}

export function CoverageMatrix({ stateMetrics, onStateClick }: CoverageMatrixProps) {
  const states = Object.values(stateMetrics).sort((a, b) =>
    b.coverage_percentage - a.coverage_percentage
  );

  const getCoverageColor = (percentage: number): string => {
    if (percentage === 0) return 'bg-red-100 text-red-800';
    if (percentage < 50) return 'bg-yellow-100 text-yellow-800';
    if (percentage < 100) return 'bg-blue-100 text-blue-800';
    return 'bg-green-100 text-green-800';
  };

  const getCoverageBorderColor = (percentage: number): string => {
    if (percentage === 0) return 'border-red-300';
    if (percentage < 50) return 'border-yellow-300';
    if (percentage < 100) return 'border-blue-300';
    return 'border-green-300';
  };

  if (states.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="text-lg font-medium">No states found</p>
        <p className="text-sm mt-1">Run a process execution to generate coverage data</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b-2 border-gray-200">
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              State Name
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
              Coverage
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
              Screenshots
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
              Actions
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
              Action Types
            </th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">
              Patterns
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              Last Tested
            </th>
          </tr>
        </thead>
        <tbody>
          {states.map((state, index) => (
            <tr
              key={state.state_name}
              className={`
                border-b border-gray-200 hover:bg-gray-50 transition-colors
                ${onStateClick ? 'cursor-pointer' : ''}
              `}
              onClick={() => onStateClick?.(state.state_name)}
            >
              {/* State Name */}
              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{state.state_name}</span>
                  {state.screenshot_count === 0 && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                      Uncovered
                    </span>
                  )}
                </div>
              </td>

              {/* Coverage Percentage */}
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-2">
                  <div
                    className={`
                      px-3 py-1 rounded-full text-sm font-semibold border
                      ${getCoverageColor(state.coverage_percentage)}
                      ${getCoverageBorderColor(state.coverage_percentage)}
                    `}
                  >
                    {state.coverage_percentage.toFixed(0)}%
                  </div>
                </div>
              </td>

              {/* Screenshots */}
              <td className="px-4 py-3 text-center text-sm text-gray-700">
                {state.screenshot_count}
              </td>

              {/* Actions Performed */}
              <td className="px-4 py-3 text-center text-sm text-gray-700">
                {state.actions_performed}
              </td>

              {/* Action Types */}
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1 flex-wrap">
                  {state.action_types.length > 0 ? (
                    state.action_types.map((type) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-mono"
                      >
                        {type}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-400 text-xs">None</span>
                  )}
                </div>
              </td>

              {/* Patterns Tested */}
              <td className="px-4 py-3 text-center text-sm text-gray-700">
                {state.patterns_tested.length}
              </td>

              {/* Last Tested */}
              <td className="px-4 py-3 text-sm text-gray-600">
                {state.last_tested ? (
                  <span title={new Date(state.last_tested).toLocaleString()}>
                    {formatDistanceToNow(new Date(state.last_tested), { addSuffix: true })}
                  </span>
                ) : (
                  <span className="text-gray-400">Never</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary Stats */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-gray-900">{states.length}</div>
            <div className="text-sm text-gray-600">Total States</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {states.filter(s => s.coverage_percentage === 100).length}
            </div>
            <div className="text-sm text-gray-600">Fully Covered</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-yellow-600">
              {states.filter(s => s.coverage_percentage > 0 && s.coverage_percentage < 100).length}
            </div>
            <div className="text-sm text-gray-600">Partial</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">
              {states.filter(s => s.coverage_percentage === 0).length}
            </div>
            <div className="text-sm text-gray-600">Uncovered</div>
          </div>
        </div>
      </div>
    </div>
  );
}
