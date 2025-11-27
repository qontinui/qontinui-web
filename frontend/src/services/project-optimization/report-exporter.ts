/**
 * Report Exporter Module
 *
 * Responsible for exporting optimization reports
 */

import type { Workflow } from '@/lib/action-schema/action-types';
import type { State, ImageAsset, Transition } from '@/contexts/automation-context/types';
import type { OptimizationReport } from './types';
import { getHealthReport } from './health-analyzer';

/**
 * Export optimization report
 */
export function exportOptimizationReport(
  workflows: Workflow[],
  states: State[],
  images: ImageAsset[],
  transitions: Transition[]
): OptimizationReport {
  const healthReport = getHealthReport(workflows, states, images, transitions);

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      projectName: 'qontinui-project',
      version: '1.0.0',
    },
    health: healthReport.health,
    suggestions: healthReport.suggestions,
    issues: healthReport.issues,
    resources: {
      workflows: workflows.length,
      states: states.length,
      images: images.length,
      transitions: transitions.length,
    },
    storage: healthReport.storage,
  };
}
