import React, { useState, useEffect } from 'react';
import { X, Settings, Link } from 'lucide-react';
import { ScreenshotRegion, Screenshot } from '../../types/Screenshot';

interface RegionPropertiesPanelProps {
  selectedRegion: ScreenshotRegion;
  states: any[]; // Will be replaced with proper State type
  screenshots: Screenshot[];
  onUpdate: (region: ScreenshotRegion) => void;
  onDelete: (regionId: string) => void;
}

const RegionPropertiesPanel: React.FC<RegionPropertiesPanelProps> = ({
  selectedRegion,
  states,
  screenshots,
  onUpdate,
  onDelete
}) => {
  const [region, setRegion] = useState<ScreenshotRegion>(selectedRegion);
  const [showLinkDialog, setShowLinkDialog] = useState(false);

  useEffect(() => {
    setRegion(selectedRegion);
  }, [selectedRegion]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const updatedRegion = { ...region, name: e.target.value };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
  };

  const handleTypeChange = (type: 'StateRegion' | 'SearchRegion') => {
    const updatedRegion = { ...region, type };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
  };

  const handleBoundsChange = (field: 'x' | 'y' | 'width' | 'height', value: number) => {
    const updatedRegion = {
      ...region,
      bounds: {
        ...region.bounds,
        [field]: value
      }
    };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
  };

  const handleLinkStateObject = (stateObjectId: string, type: string) => {
    const updatedRegion = {
      ...region,
      linkedStateObjectId: stateObjectId,
      linkedStateObjectType: type as 'StateImage'
    };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
    setShowLinkDialog(false);
  };

  const getAvailableStateImages = () => {
    // Get all StateImages from the associated state
    const state = states.find(s => s.id === region.stateId);
    if (!state) return [];

    // For now, return mock data - will be replaced with actual state objects
    return state.stateImages || [];
  };

  return (
    <div className="w-80 border-l bg-white overflow-y-auto">
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Region Properties</h3>
          <button
            onClick={() => onDelete(region.id)}
            className="p-1 hover:bg-gray-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            type="text"
            value={region.name}
            onChange={handleNameChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Type
          </label>
          <div className="flex gap-2">
            <button
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                region.type === 'StateRegion'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              onClick={() => handleTypeChange('StateRegion')}
            >
              StateRegion
            </button>
            <button
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                region.type === 'SearchRegion'
                  ? 'bg-yellow-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              onClick={() => handleTypeChange('SearchRegion')}
            >
              SearchRegion
            </button>
          </div>
        </div>

        {/* Bounds */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position & Size
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500">X</label>
              <input
                type="number"
                value={region.bounds.x}
                onChange={(e) => handleBoundsChange('x', Number(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Y</label>
              <input
                type="number"
                value={region.bounds.y}
                onChange={(e) => handleBoundsChange('y', Number(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Width</label>
              <input
                type="number"
                value={region.bounds.width}
                onChange={(e) => handleBoundsChange('width', Number(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Height</label>
              <input
                type="number"
                value={region.bounds.height}
                onChange={(e) => handleBoundsChange('height', Number(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        </div>

        {/* Link to StateImage (only for SearchRegions) */}
        {region.type === 'SearchRegion' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Linked StateImage
            </label>
            {region.linkedStateObjectId ? (
              <div className="flex items-center justify-between p-2 bg-blue-50 rounded">
                <span className="text-sm text-blue-700">
                  {region.linkedStateObjectId}
                </span>
                <button
                  onClick={() => setShowLinkDialog(true)}
                  className="p-1 hover:bg-blue-100 rounded"
                >
                  <Settings className="w-4 h-4 text-blue-600" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowLinkDialog(true)}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 border border-dashed border-gray-300 rounded-md text-sm text-gray-600 hover:border-gray-400 hover:text-gray-700"
              >
                <Link className="w-4 h-4" />
                Link to StateImage
              </button>
            )}
          </div>
        )}

        {/* State Association */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Associated State
          </label>
          <select
            value={region.stateId}
            onChange={(e) => {
              const updatedRegion = { ...region, stateId: e.target.value };
              setRegion(updatedRegion);
              onUpdate(updatedRegion);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">No state selected</option>
            {states.map(state => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </div>

        {/* Advanced Properties */}
        <details className="border-t pt-4">
          <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
            Advanced Properties
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Screenshot ID
              </label>
              <div className="px-2 py-1 bg-gray-50 rounded text-xs font-mono">
                {region.screenshotId}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Region ID
              </label>
              <div className="px-2 py-1 bg-gray-50 rounded text-xs font-mono">
                {region.id}
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* Link StateImage Dialog */}
      {showLinkDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-4">Link to StateImage</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {getAvailableStateImages().length > 0 ? (
                getAvailableStateImages().map((stateImage: any) => (
                  <button
                    key={stateImage.id}
                    onClick={() => handleLinkStateObject(stateImage.id, 'StateImage')}
                    className="w-full text-left p-3 border rounded-md hover:bg-gray-50 transition-colors"
                  >
                    <div className="font-medium">{stateImage.name}</div>
                    <div className="text-sm text-gray-500">{stateImage.id}</div>
                  </button>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">
                  No StateImages available in the associated state
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowLinkDialog(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RegionPropertiesPanel;
