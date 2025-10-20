/**
 * Preset Manager Dialog
 *
 * Dialog for managing layout presets.
 * Features:
 * - List of all presets (built-in + custom)
 * - Category filter
 * - Search presets
 * - Preview preset
 * - Edit custom presets
 * - Delete custom presets
 * - Export preset
 * - Import preset
 * - Set as default
 */

import React, { useState, useEffect } from 'react';
import { LayoutStyle } from '@/lib/workflow-layout/auto-layout';
import type { LayoutOptions } from '@/services/layout-service';

// ============================================================================
// Types
// ============================================================================

export interface PresetManagerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectPreset: (preset: LayoutPreset) => void;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  category: 'compact' | 'spacious' | 'balanced' | 'custom';
  style: LayoutStyle;
  options: LayoutOptions;
  builtin: boolean;
}

// ============================================================================
// Preset Manager Dialog Component
// ============================================================================

export function PresetManagerDialog({ open, onClose, onSelectPreset }: PresetManagerDialogProps) {
  const [presets, setPresets] = useState<LayoutPreset[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'compact' | 'spacious' | 'balanced' | 'custom'>('all');
  const [selectedPreset, setSelectedPreset] = useState<LayoutPreset | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  useEffect(() => {
    if (open) {
      loadPresets();
    }
  }, [open]);

  const loadPresets = () => {
    try {
      const saved = localStorage.getItem('auto-layout-custom-presets');
      const customPresets = saved ? JSON.parse(saved) : [];
      setPresets([...BUILTIN_PRESETS, ...customPresets]);
    } catch (err) {
      console.error('Failed to load presets:', err);
      setPresets([...BUILTIN_PRESETS]);
    }
  };

  const filteredPresets = presets.filter(preset => {
    if (selectedCategory !== 'all' && preset.category !== selectedCategory) {
      return false;
    }
    if (searchQuery && !preset.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const handleDelete = (presetId: string) => {
    if (!confirm('Delete this preset?')) return;

    const updated = presets.filter(p => p.id !== presetId && p.builtin);
    const customPresets = updated.filter(p => !p.builtin);

    try {
      localStorage.setItem('auto-layout-custom-presets', JSON.stringify(customPresets));
      setPresets(updated);
    } catch (err) {
      console.error('Failed to delete preset:', err);
    }
  };

  const handleExport = (preset: LayoutPreset) => {
    const json = JSON.stringify(preset, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `layout-preset-${preset.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const preset = JSON.parse(event.target?.result as string) as LayoutPreset;
          preset.id = `custom-${Date.now()}`;
          preset.builtin = false;
          preset.category = 'custom';

          const customPresets = presets.filter(p => !p.builtin);
          customPresets.push(preset);

          localStorage.setItem('auto-layout-custom-presets', JSON.stringify(customPresets));
          loadPresets();
        } catch (err) {
          alert('Failed to import preset: Invalid file format');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  if (!open) return null;

  return (
    <div className="preset-manager-overlay">
      <div className="preset-manager-dialog">
        <div className="dialog-header">
          <h2>Manage Layout Presets</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="dialog-toolbar">
          <input
            type="text"
            placeholder="Search presets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <button className="import-button" onClick={handleImport}>
            📥 Import
          </button>
        </div>

        <div className="category-filter">
          {(['all', 'compact', 'spacious', 'balanced', 'custom'] as const).map(cat => (
            <button
              key={cat}
              className={selectedCategory === cat ? 'active' : ''}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <div className="presets-list">
          {filteredPresets.map(preset => (
            <div
              key={preset.id}
              className={`preset-item ${selectedPreset?.id === preset.id ? 'selected' : ''}`}
              onClick={() => setSelectedPreset(preset)}
            >
              <div className="preset-info">
                <h4>{preset.name}</h4>
                <p>{preset.description}</p>
                <div className="preset-meta">
                  <span className={`category-badge ${preset.category}`}>{preset.category}</span>
                  <span className="style-badge">{preset.style}</span>
                  {preset.builtin && <span className="builtin-badge">Built-in</span>}
                </div>
              </div>

              <div className="preset-actions">
                <button
                  className="use-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPreset(preset);
                    onClose();
                  }}
                >
                  Use
                </button>
                <button
                  className="export-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport(preset);
                  }}
                >
                  📤
                </button>
                {!preset.builtin && (
                  <>
                    <button
                      className="edit-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPreset(preset);
                        setShowEditDialog(true);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="delete-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(preset.id);
                      }}
                    >
                      🗑️
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredPresets.length === 0 && (
          <div className="no-presets">
            <p>No presets found</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Built-in Presets (simplified)
// ============================================================================

const BUILTIN_PRESETS: LayoutPreset[] = [
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
    },
    builtin: true
  }
];
