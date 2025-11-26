'use client'

/**
 * Pattern Optimization Page
 *
 * Optimize image patterns for better matching accuracy and performance.
 * Allows users to:
 * - Test pattern matching algorithms on sample images
 * - Adjust matching parameters (threshold, similarity, scales)
 * - Compare different pattern matching methods
 * - Optimize patterns for speed vs accuracy
 * - Identify problematic patterns
 * - Fine-tune match confidence settings
 * - Generate optimized pattern configurations
 */

import { PatternOptimizationSimplified } from '@/components/pattern-optimization/PatternOptimizationSimplified'
import { RequireProject } from '@/components/require-project'

export default function PatternOptimizationPage() {
  return (
    <RequireProject pageName="Optimize Patterns">
      <PatternOptimizationSimplified />
    </RequireProject>
  )
}
