import React, { useState, useEffect } from 'react';
import { StateImage } from '../../types/stateDiscovery';
import { MaskVisualization } from '../masks/MaskVisualization';
import { ScreenshotSelector } from '../screenshot-selector';
import { useAutomation } from '../../contexts/automation-context';

interface Pattern {
  id: string;
  name: string;
  width: number;
  height: number;
  maskDensity: number;
  maskType: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  similarityThreshold: number;
  useColor: boolean;
  matchCount: number;
  successRate: number;
  avgMatchTime: number;
  activePixels: number;
  totalPixels: number;
  variationCount: number;
  optimizationCount: number;
}

export const PatternOptimizationTab: React.FC = () => {
  const { screenshots } = useAutomation();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [stateImages, setStateImages] = useState<StateImage[]>([]);
  const [selectedStateImage, setSelectedStateImage] = useState<StateImage | null>(null);
  const [selectedScreenshotId, setSelectedScreenshotId] = useState<string>('');
  const [isCreatingPattern, setIsCreatingPattern] = useState(false);
  const [patternName, setPatternName] = useState('');
  const [similarityThreshold, setSimilarityThreshold] = useState(0.95);
  const [useColor, setUseColor] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);

  useEffect(() => {
    fetchPatterns();
    // In production, would also fetch StateImages from the current project
  }, []);

  const fetchPatterns = async () => {
    try {
      const response = await fetch('/api/masks/patterns');
      if (response.ok) {
        const data = await response.json();
        setPatterns(data);
      }
    } catch (error) {
      console.error('Failed to fetch patterns:', error);
    }
  };

  const createPatternFromStateImage = async () => {
    if (!selectedStateImage || !patternName) return;

    setIsCreatingPattern(true);
    try {
      const response = await fetch('/api/state-discovery/pattern/from-state-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state_image_id: selectedStateImage.id,
          pattern_name: patternName,
          similarity_threshold: similarityThreshold
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Pattern created:', data);
        fetchPatterns(); // Refresh patterns list
        setPatternName('');
      }
    } catch (error) {
      console.error('Failed to create pattern:', error);
    } finally {
      setIsCreatingPattern(false);
    }
  };

  const optimizePattern = async () => {
    if (!selectedPattern) return;

    setIsOptimizing(true);
    try {
      // In production, would gather positive/negative samples
      const response = await fetch(`/api/masks/patterns/${selectedPattern.id}/optimize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pattern_id: selectedPattern.id,
          positive_samples: [], // Would include actual samples
          negative_samples: [],
          method: 'stability'
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Pattern optimized:', data);
        fetchPatterns(); // Refresh patterns
      }
    } catch (error) {
      console.error('Failed to optimize pattern:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="pattern-optimization-tab p-4">
      <div className="grid grid-cols-3 gap-4">
        {/* Patterns List */}
        <div className="col-span-1 bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-3">Patterns</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {patterns.map(pattern => (
              <div
                key={pattern.id}
                onClick={() => setSelectedPattern(pattern)}
                className={`p-2 border rounded cursor-pointer hover:bg-gray-50 ${
                  selectedPattern?.id === pattern.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="font-medium text-sm">{pattern.name}</div>
                <div className="text-xs text-gray-600">
                  {pattern.width}x{pattern.height} • Density: {Math.round(pattern.maskDensity * 100)}%
                </div>
                <div className="text-xs text-gray-500">
                  Matches: {pattern.matchCount} • Success: {Math.round(pattern.successRate * 100)}%
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t">
            <h3 className="text-sm font-semibold mb-2">Create Pattern from StateImage</h3>
            <select
              value={selectedStateImage?.id || ''}
              onChange={(e) => {
                const si = stateImages.find(s => s.id === e.target.value);
                setSelectedStateImage(si || null);
              }}
              className="w-full text-sm border rounded px-2 py-1 mb-2"
            >
              <option value="">Select StateImage...</option>
              {stateImages.map(si => (
                <option key={si.id} value={si.id}>{si.name}</option>
              ))}
            </select>

            <div className="mb-2">
              <label className="text-xs text-gray-600 block mb-1">Screenshot</label>
              <ScreenshotSelector
                selectedScreenshot={selectedScreenshotId}
                onSelectScreenshot={setSelectedScreenshotId}
                allowUpload={true}
              />
            </div>

            <input
              type="text"
              placeholder="Pattern name"
              value={patternName}
              onChange={(e) => setPatternName(e.target.value)}
              className="w-full text-sm border rounded px-2 py-1 mb-2"
            />
            <div className="mb-2">
              <label className="text-xs text-gray-600">
                Similarity: {(similarityThreshold * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="50"
                max="100"
                value={similarityThreshold * 100}
                onChange={(e) => setSimilarityThreshold(Number(e.target.value) / 100)}
                className="w-full"
              />
            </div>
            <button
              onClick={createPatternFromStateImage}
              disabled={!selectedStateImage || !patternName || isCreatingPattern}
              className="w-full px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm"
            >
              {isCreatingPattern ? 'Creating...' : 'Create Pattern'}
            </button>
          </div>
        </div>

        {/* Pattern Details */}
        <div className="col-span-2 bg-white rounded-lg shadow p-4">
          {selectedPattern ? (
            <>
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{selectedPattern.name}</h2>
                  <div className="text-sm text-gray-600 mt-1">
                    ID: {selectedPattern.id}
                  </div>
                </div>
                <button
                  onClick={optimizePattern}
                  disabled={isOptimizing}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 text-sm"
                >
                  {isOptimizing ? 'Optimizing...' : 'Optimize Mask'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Pattern Properties</h3>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-gray-600">Dimensions:</span> {selectedPattern.width}x{selectedPattern.height}
                    </div>
                    <div>
                      <span className="text-gray-600">Mask Type:</span> {selectedPattern.maskType}
                    </div>
                    <div>
                      <span className="text-gray-600">Mask Density:</span> {Math.round(selectedPattern.maskDensity * 100)}%
                    </div>
                    <div>
                      <span className="text-gray-600">Active Pixels:</span> {selectedPattern.activePixels.toLocaleString()}
                    </div>
                    <div>
                      <span className="text-gray-600">Total Pixels:</span> {selectedPattern.totalPixels.toLocaleString()}
                    </div>
                    <div>
                      <span className="text-gray-600">Similarity Threshold:</span> {Math.round(selectedPattern.similarityThreshold * 100)}%
                    </div>
                    <div>
                      <span className="text-gray-600">Use Color:</span> {selectedPattern.useColor ? 'Yes' : 'No'}
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold mt-4 mb-2">Performance Metrics</h3>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-gray-600">Match Count:</span> {selectedPattern.matchCount}
                    </div>
                    <div>
                      <span className="text-gray-600">Success Rate:</span> {Math.round(selectedPattern.successRate * 100)}%
                    </div>
                    <div>
                      <span className="text-gray-600">Avg Match Time:</span> {selectedPattern.avgMatchTime.toFixed(2)}ms
                    </div>
                    <div>
                      <span className="text-gray-600">Variations:</span> {selectedPattern.variationCount}
                    </div>
                    <div>
                      <span className="text-gray-600">Optimizations:</span> {selectedPattern.optimizationCount}
                    </div>
                  </div>

                  {selectedPattern.tags.length > 0 && (
                    <>
                      <h3 className="text-sm font-semibold mt-4 mb-2">Tags</h3>
                      <div className="flex flex-wrap gap-1">
                        {selectedPattern.tags.map((tag, i) => (
                          <span key={i} className="px-2 py-1 bg-gray-100 text-xs rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Mask Preview</h3>
                  <div className="border border-gray-200 rounded p-2">
                    {/* In production, would show actual mask visualization */}
                    <div className="h-64 bg-gray-100 flex items-center justify-center text-gray-500">
                      Mask Visualization
                    </div>
                  </div>

                  <div className="mt-4">
                    <h4 className="text-xs font-semibold mb-1">Optimization History</h4>
                    <div className="h-24 bg-gray-50 border border-gray-200 rounded p-2 overflow-y-auto">
                      <div className="text-xs text-gray-600">
                        {selectedPattern.optimizationCount > 0
                          ? `${selectedPattern.optimizationCount} optimization(s) performed`
                          : 'No optimizations yet'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              Select a pattern to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
