/**
 * Auto-Layout Panel
 *
 * Advanced panel for auto-layout configuration and preview.
 * Features:
 * - Layout style selector (5 styles with icons)
 * - Preset dropdown (10 presets)
 * - Spacing controls (horizontal, vertical sliders)
 * - Live preview (mini canvas)
 * - Statistics comparison (before/after)
 * - Suggestions panel (detected issues)
 * - Apply button with animation option
 * - Save as preset button
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { Workflow } from '@/lib/action-schema/action-types';
import { getLayoutService, LayoutOptions, LayoutPreviewResult } from '@/services/layout-service';
import { LayoutStyle } from '@/lib/workflow-layout/auto-layout';
import { LayoutPreview } from './LayoutPreview';
import { LayoutSuggestions } from './LayoutSuggestions';
import { formatStatistics } from '@/services/layout-statistics';

// ============================================================================
// Types
// ============================================================================

export interface AutoLayoutPanelProps {
  workflow: Workflow;
  onApplyLayout: (workflow: Workflow, animated: boolean) => void;
  onClose?: () => void;
}

interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  category: 'compact' | 'spacious' | 'balanced' | 'custom';
  style: LayoutStyle;
  options: LayoutOptions;
}

// ============================================================================
// Built-in Presets
// ============================================================================

const BUILTIN_PRESETS: LayoutPreset[] = [
  {
    id: 'compact-hierarchical',
    name: 'Compact Hierarchical',
    description: 'Dense top-to-bottom layout',
    category: 'compact',
    style: LayoutStyle.HIERARCHICAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 150,
      verticalSpacing: 100,
      branchOffset: 120,
      minNodeSpacing: 15
    }
  },
  {
    id: 'spacious-hierarchical',
    name: 'Spacious Hierarchical',
    description: 'Roomy top-to-bottom layout',
    category: 'spacious',
    style: LayoutStyle.HIERARCHICAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 250,
      verticalSpacing: 150,
      branchOffset: 180,
      minNodeSpacing: 30
    }
  },
  {
    id: 'balanced-hierarchical',
    name: 'Balanced Hierarchical',
    description: 'Standard top-to-bottom layout',
    category: 'balanced',
    style: LayoutStyle.HIERARCHICAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20
    }
  },
  {
    id: 'compact-horizontal',
    name: 'Compact Horizontal',
    description: 'Dense left-to-right layout',
    category: 'compact',
    style: LayoutStyle.HORIZONTAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 150,
      verticalSpacing: 100,
      branchOffset: 120,
      minNodeSpacing: 15
    }
  },
  {
    id: 'spacious-horizontal',
    name: 'Spacious Horizontal',
    description: 'Roomy left-to-right layout',
    category: 'spacious',
    style: LayoutStyle.HORIZONTAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 250,
      verticalSpacing: 150,
      branchOffset: 180,
      minNodeSpacing: 30
    }
  },
  {
    id: 'balanced-tree',
    name: 'Balanced Tree',
    description: 'Standard tree layout',
    category: 'balanced',
    style: LayoutStyle.TREE,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 180,
      verticalSpacing: 110,
      branchOffset: 140,
      minNodeSpacing: 20
    }
  },
  {
    id: 'force-directed-default',
    name: 'Force-Directed Default',
    description: 'Physics-based organic layout',
    category: 'balanced',
    style: LayoutStyle.FORCE_DIRECTED,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 25
    }
  },
  {
    id: 'circular-default',
    name: 'Circular Default',
    description: 'Nodes arranged in a circle',
    category: 'balanced',
    style: LayoutStyle.CIRCULAR,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20
    }
  },
  {
    id: 'presentation-mode',
    name: 'Presentation Mode',
    description: 'Extra spacious for presentations',
    category: 'spacious',
    style: LayoutStyle.HIERARCHICAL,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 300,
      verticalSpacing: 180,
      branchOffset: 200,
      minNodeSpacing: 40
    }
  },
  {
    id: 'debug-mode',
    name: 'Debug Mode',
    description: 'Ultra compact for debugging',
    category: 'compact',
    style: LayoutStyle.TREE,
    options: {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 120,
      verticalSpacing: 90,
      branchOffset: 100,
      minNodeSpacing: 10
    }
  }
];

// ============================================================================
// Layout Style Info
// ============================================================================

interface LayoutStyleInfo {
  name: string;
  description: string;
  icon: string;
  bestFor: string[];
}

const LAYOUT_STYLES: Record<LayoutStyle, LayoutStyleInfo> = {
  [LayoutStyle.HIERARCHICAL]: {
    name: 'Hierarchical',
    description: 'Top-to-bottom flow',
    icon: '⬇️',
    bestFor: ['Branching workflows', 'Deep hierarchies', 'General purpose']
  },
  [LayoutStyle.HORIZONTAL]: {
    name: 'Horizontal',
    description: 'Left-to-right flow',
    icon: '➡️',
    bestFor: ['Linear workflows', 'Sequential processes', 'Timelines']
  },
  [LayoutStyle.TREE]: {
    name: 'Tree',
    description: 'Compact tree structure',
    icon: '🌳',
    bestFor: ['Deeply nested workflows', 'Compact layouts', 'Decision trees']
  },
  [LayoutStyle.FORCE_DIRECTED]: {
    name: 'Force-Directed',
    description: 'Physics-based layout',
    icon: '🔮',
    bestFor: ['Complex graphs', 'Interconnected nodes', 'Organic structures']
  },
  [LayoutStyle.CIRCULAR]: {
    name: 'Circular',
    description: 'Circular arrangement',
    icon: '⭕',
    bestFor: ['Small workflows', 'Cycles', 'Visualization']
  }
};

// ============================================================================
// Auto-Layout Panel Component
// ============================================================================

export function AutoLayoutPanel({ workflow, onApplyLayout, onClose }: AutoLayoutPanelProps) {
  const layoutService = useMemo(() => getLayoutService(), []);

  // State
  const [selectedStyle, setSelectedStyle] = useState<LayoutStyle>(LayoutStyle.HIERARCHICAL);
  const [selectedPreset, setSelectedPreset] = useState<string>('balanced-hierarchical');
  const [customOptions, setCustomOptions] = useState<LayoutOptions>(BUILTIN_PRESETS[2].options);
  const [animate, setAnimate] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showStatistics, setShowStatistics] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [previewResult, setPreviewResult] = useState<LayoutPreviewResult | null>(null);
  const [customPresets, setCustomPresets] = useState<LayoutPreset[]>([]);

  // Load custom presets from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('auto-layout-custom-presets');
      if (saved) {
        setCustomPresets(JSON.parse(saved));
      }
    } catch (err) {
      console.error('Failed to load custom presets:', err);
    }
  }, []);

  // Get recommended layout
  const recommendation = useMemo(() => {
    return layoutService.getRecommendedLayout(workflow);
  }, [workflow, layoutService]);

  // Update preview when settings change
  useEffect(() => {
    updatePreview();
  }, [selectedStyle, customOptions]);

  const updatePreview = () => {
    const result = layoutService.previewLayout(workflow, selectedStyle, customOptions);
    setPreviewResult(result);
  };

  const handleStyleChange = (style: LayoutStyle) => {
    setSelectedStyle(style);
    // Update preset selection if it matches
    const matchingPreset = [...BUILTIN_PRESETS, ...customPresets].find(
      p => p.style === style && p.id === selectedPreset
    );
    if (!matchingPreset) {
      setSelectedPreset('custom');
    }
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId);
    const preset = [...BUILTIN_PRESETS, ...customPresets].find(p => p.id === presetId);
    if (preset) {
      setSelectedStyle(preset.style);
      setCustomOptions(preset.options);
    }
  };

  const handleOptionChange = (key: keyof LayoutOptions, value: number) => {
    setCustomOptions(prev => ({ ...prev, [key]: value }));
    setSelectedPreset('custom'); // Mark as custom
  };

  const handleApply = () => {
    if (previewResult) {
      onApplyLayout(previewResult.workflow, animate);
    }
  };

  const handleSavePreset = () => {
    const name = prompt('Enter preset name:');
    if (!name) return;

    const description = prompt('Enter preset description (optional):') || '';

    const newPreset: LayoutPreset = {
      id: `custom-${Date.now()}`,
      name,
      description,
      category: 'custom',
      style: selectedStyle,
      options: { ...customOptions }
    };

    const updated = [...customPresets, newPreset];
    setCustomPresets(updated);

    try {
      localStorage.setItem('auto-layout-custom-presets', JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to save preset:', err);
    }

    setSelectedPreset(newPreset.id);
  };

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];
  const needsLayout = layoutService.needsLayout(workflow);

  return (
    <div className="auto-layout-panel">
      {/* Header */}
      <div className="panel-header">
        <h2>Auto-Layout</h2>
        {onClose && (
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      <div className="panel-content">
        {/* Recommendation Banner */}
        {recommendation.confidence > 0.7 && (
          <div className="recommendation-banner">
            <div className="recommendation-icon">💡</div>
            <div className="recommendation-text">
              <strong>Recommended:</strong> {LAYOUT_STYLES[recommendation.style].name}
              <p>{recommendation.reason}</p>
            </div>
            {selectedStyle !== recommendation.style && (
              <button
                className="use-recommendation-button"
                onClick={() => handleStyleChange(recommendation.style)}
              >
                Use This
              </button>
            )}
          </div>
        )}

        {/* Layout Style Selection */}
        <section className="style-selection">
          <h3>Layout Style</h3>
          <div className="style-grid">
            {Object.entries(LAYOUT_STYLES).map(([styleKey, info]) => (
              <StyleButton
                key={styleKey}
                style={styleKey as LayoutStyle}
                info={info}
                selected={selectedStyle === styleKey}
                onClick={() => handleStyleChange(styleKey as LayoutStyle)}
              />
            ))}
          </div>
        </section>

        {/* Preset Selection */}
        <section className="preset-selection">
          <h3>Presets</h3>
          <select
            className="preset-dropdown"
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            <option value="custom">Custom Settings</option>
            <optgroup label="Compact">
              {allPresets
                .filter(p => p.category === 'compact')
                .map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Balanced">
              {allPresets
                .filter(p => p.category === 'balanced')
                .map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Spacious">
              {allPresets
                .filter(p => p.category === 'spacious')
                .map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
            </optgroup>
            {customPresets.length > 0 && (
              <optgroup label="Custom">
                {customPresets.map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {selectedPreset !== 'custom' && (
            <p className="preset-description">
              {allPresets.find(p => p.id === selectedPreset)?.description}
            </p>
          )}
        </section>

        {/* Spacing Controls */}
        <section className="spacing-controls">
          <h3>Spacing</h3>

          <div className="control-group">
            <label>
              <span>Horizontal Spacing:</span>
              <span className="value">{customOptions.horizontalSpacing}px</span>
            </label>
            <input
              type="range"
              min="100"
              max="400"
              step="10"
              value={customOptions.horizontalSpacing}
              onChange={(e) => handleOptionChange('horizontalSpacing', parseInt(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>
              <span>Vertical Spacing:</span>
              <span className="value">{customOptions.verticalSpacing}px</span>
            </label>
            <input
              type="range"
              min="80"
              max="300"
              step="10"
              value={customOptions.verticalSpacing}
              onChange={(e) => handleOptionChange('verticalSpacing', parseInt(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>
              <span>Branch Offset:</span>
              <span className="value">{customOptions.branchOffset}px</span>
            </label>
            <input
              type="range"
              min="80"
              max="300"
              step="10"
              value={customOptions.branchOffset}
              onChange={(e) => handleOptionChange('branchOffset', parseInt(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>
              <span>Minimum Node Spacing:</span>
              <span className="value">{customOptions.minNodeSpacing}px</span>
            </label>
            <input
              type="range"
              min="10"
              max="50"
              step="5"
              value={customOptions.minNodeSpacing}
              onChange={(e) => handleOptionChange('minNodeSpacing', parseInt(e.target.value))}
            />
          </div>
        </section>

        {/* Preview Section */}
        {showPreview && previewResult && (
          <section className="preview-section">
            <div className="section-header">
              <h3>Preview</h3>
              <button
                className="toggle-button"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? 'Hide' : 'Show'}
              </button>
            </div>
            <LayoutPreview
              beforeWorkflow={workflow}
              afterWorkflow={previewResult.workflow}
              comparison={previewResult.comparison}
              mode="side-by-side"
            />
          </section>
        )}

        {/* Statistics Section */}
        {showStatistics && previewResult && (
          <section className="statistics-section">
            <div className="section-header">
              <h3>Statistics</h3>
              <button
                className="toggle-button"
                onClick={() => setShowStatistics(!showStatistics)}
              >
                {showStatistics ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className="statistics-comparison">
              <div className="stat-column">
                <h4>Before</h4>
                {Object.entries(formatStatistics(previewResult.comparison.metrics.overlaps.before as any)).slice(0, 5).map(([key, value]) => (
                  <div key={key} className="stat-item">
                    <span className="stat-label">{key}:</span>
                    <span className="stat-value">{value}</span>
                  </div>
                ))}
              </div>

              <div className="stat-column">
                <h4>After</h4>
                {Object.entries(formatStatistics(previewResult.statistics)).slice(0, 5).map(([key, value]) => (
                  <div key={key} className="stat-item">
                    <span className="stat-label">{key}:</span>
                    <span className="stat-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="improvement-summary">
              <div className={`improvement-badge ${previewResult.comparison.isImprovement ? 'positive' : 'negative'}`}>
                {previewResult.comparison.improvementScore > 0 ? '+' : ''}
                {Math.round(previewResult.comparison.improvementScore)}
              </div>
              <p>{previewResult.comparison.summary}</p>
            </div>
          </section>
        )}

        {/* Suggestions Section */}
        {showSuggestions && previewResult && (
          <section className="suggestions-section">
            <div className="section-header">
              <h3>Suggestions</h3>
              <button
                className="toggle-button"
                onClick={() => setShowSuggestions(!showSuggestions)}
              >
                {showSuggestions ? 'Hide' : 'Show'}
              </button>
            </div>
            <LayoutSuggestions
              workflow={workflow}
              layoutResult={previewResult}
              onApplySuggestion={(fixedWorkflow) => {
                // Apply the fixed workflow
                onApplyLayout(fixedWorkflow, false);
              }}
            />
          </section>
        )}
      </div>

      {/* Footer Actions */}
      <div className="panel-footer">
        <div className="footer-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={animate}
              onChange={(e) => setAnimate(e.target.checked)}
            />
            <span>Animate layout transition</span>
          </label>
        </div>

        <div className="footer-buttons">
          <button
            className="save-preset-button"
            onClick={handleSavePreset}
            disabled={selectedPreset !== 'custom'}
          >
            Save as Preset
          </button>
          <button
            className="apply-button"
            onClick={handleApply}
            disabled={!previewResult}
          >
            Apply Layout
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Style Button Component
// ============================================================================

interface StyleButtonProps {
  style: LayoutStyle;
  info: LayoutStyleInfo;
  selected: boolean;
  onClick: () => void;
}

function StyleButton({ style, info, selected, onClick }: StyleButtonProps) {
  return (
    <button
      className={`style-button ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="style-icon">{info.icon}</div>
      <div className="style-info">
        <strong>{info.name}</strong>
        <p className="description">{info.description}</p>
        <div className="best-for">
          <small>Best for:</small>
          <ul>
            {info.bestFor.slice(0, 2).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </button>
  );
}
