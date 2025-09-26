import React, { useState, useEffect } from 'react';
import { X, Target, Anchor, MousePointer, Image } from 'lucide-react';
import { ScreenshotLocation, Screenshot, AnchorType } from '../../types/Screenshot';
import { StateImage } from '../../contexts/automation-context/types';

interface LocationPropertiesPanelProps {
  selectedLocation: ScreenshotLocation;
  states: any[]; // Will be replaced with proper State type
  screenshots: Screenshot[];
  onUpdate: (location: ScreenshotLocation) => void;
  onDelete: (locationId: string) => void;
}

const LocationPropertiesPanel: React.FC<LocationPropertiesPanelProps> = ({
  selectedLocation,
  states,
  screenshots,
  onUpdate,
  onDelete
}) => {
  const [location, setLocation] = useState<ScreenshotLocation>(selectedLocation);

  useEffect(() => {
    setLocation(selectedLocation);
  }, [selectedLocation]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const updatedLocation = { ...location, name: e.target.value };
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
  };

  const handleCoordinateChange = (axis: 'x' | 'y', value: number) => {
    const updatedLocation = {
      ...location,
      [axis]: value
    };
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
  };

  const handlePropertyToggle = (property: 'anchor' | 'fixed' | 'clickTarget') => {
    const updatedLocation = {
      ...location,
      [property]: !location[property]
    };
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
  };

  const getScreenshot = () => {
    return screenshots.find(s => s.id === location.screenshotId);
  };

  return (
    <div className="w-80 border-l bg-white overflow-y-auto">
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Location Properties</h3>
          <button
            onClick={() => onDelete(location.id)}
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
            value={location.name}
            onChange={handleNameChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Coordinates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500">X</label>
              <input
                type="number"
                value={location.x}
                onChange={(e) => handleCoordinateChange('x', Number(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Y</label>
              <input
                type="number"
                value={location.y}
                onChange={(e) => handleCoordinateChange('y', Number(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        </div>

        {/* Offsets */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position Offsets
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500">Offset X</label>
              <input
                type="number"
                value={location.offsetX || 0}
                onChange={(e) => {
                  const updatedLocation = { ...location, offsetX: Number(e.target.value) };
                  setLocation(updatedLocation);
                  onUpdate(updatedLocation);
                }}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500">Offset Y</label>
              <input
                type="number"
                value={location.offsetY || 0}
                onChange={(e) => {
                  const updatedLocation = { ...location, offsetY: Number(e.target.value) };
                  setLocation(updatedLocation);
                  onUpdate(updatedLocation);
                }}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Pixel offsets applied to the final position
          </p>
        </div>

        {/* Properties */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Properties
          </label>
          <div className="space-y-2">
            {/* Click Target */}
            <label className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-gray-600" />
                <span className="text-sm">Click Target</span>
              </div>
              <input
                type="checkbox"
                checked={location.clickTarget || false}
                onChange={() => handlePropertyToggle('clickTarget')}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            {/* Anchor Point */}
            <label className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer">
              <div className="flex items-center gap-2">
                <Anchor className="w-4 h-4 text-gray-600" />
                <span className="text-sm">Anchor Point</span>
              </div>
              <input
                type="checkbox"
                checked={location.anchor || false}
                onChange={() => {
                  const updatedLocation = {
                    ...location,
                    anchor: !location.anchor,
                    anchorType: !location.anchor ? 'CENTER' : undefined
                  };
                  setLocation(updatedLocation);
                  onUpdate(updatedLocation);
                }}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            {/* Fixed Position */}
            <label className="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer">
              <div className="flex items-center gap-2">
                <MousePointer className="w-4 h-4 text-gray-600" />
                <span className="text-sm">Fixed Position</span>
              </div>
              <input
                type="checkbox"
                checked={location.fixed || false}
                onChange={() => handlePropertyToggle('fixed')}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>
        </div>

        {/* Anchor Type Selector - shown when anchor is enabled */}
        {location.anchor && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Anchor Type (for region definition)
            </label>
            <select
              value={location.anchorType || 'CENTER'}
              onChange={(e) => {
                const updatedLocation = { ...location, anchorType: e.target.value as AnchorType };
                setLocation(updatedLocation);
                onUpdate(updatedLocation);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="TOP_LEFT">Top Left</option>
              <option value="TOP_CENTER">Top Center</option>
              <option value="TOP_RIGHT">Top Right</option>
              <option value="MIDDLE_LEFT">Middle Left</option>
              <option value="CENTER">Center</option>
              <option value="MIDDLE_RIGHT">Middle Right</option>
              <option value="BOTTOM_LEFT">Bottom Left</option>
              <option value="BOTTOM_CENTER">Bottom Center</option>
              <option value="BOTTOM_RIGHT">Bottom Right</option>
              <option value="CUSTOM">Custom Position</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Specifies which part of a region this anchor represents
            </p>
          </div>
        )}

        {/* Property Descriptions */}
        <div className="text-xs text-gray-500 space-y-1 p-2 bg-blue-50 rounded">
          <p><strong>Click Target:</strong> Use this location as an action target (click, type, hover)</p>
          <p><strong>Anchor Point:</strong> Use for defining region boundaries or spatial relationships</p>
          <p><strong>Fixed Position:</strong> Always use absolute coordinates, ignore relative positioning</p>
        </div>

        {/* Positioning Mode Indicator */}
        <div className="p-2 bg-gray-50 rounded">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${location.fixed ? 'bg-blue-500' : 'bg-green-500'}`} />
            <span className="text-sm font-medium text-gray-700">
              {location.fixed ? 'Absolute' : 'Relative'} Positioning
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {location.fixed
              ? 'Using fixed coordinates (x, y)'
              : 'Will adapt to image position at runtime'}
          </p>
        </div>

        {/* State Association */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Associated State
          </label>
          <select
            value={location.stateId}
            onChange={(e) => {
              const updatedLocation = { ...location, stateId: e.target.value };
              setLocation(updatedLocation);
              onUpdate(updatedLocation);
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

        {/* StateImage Reference (for relative positioning) */}
        {!location.fixed && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <div className="flex items-center gap-2">
                <Image className="w-4 h-4" />
                Reference Image (for relative positioning)
              </div>
            </label>
            <select
              value={location.referenceImageId || ''}
              onChange={(e) => {
                const updatedLocation = { ...location, referenceImageId: e.target.value || undefined };
                setLocation(updatedLocation);
                onUpdate(updatedLocation);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">No image reference (use state coordinates)</option>
              {/* Get StateImages from selected state */}
              {location.stateId && states.find(s => s.id === location.stateId)?.stateImages?.map((stateImage: StateImage) => (
                <option key={stateImage.id} value={stateImage.id}>
                  {stateImage.name}
                </option>
              )) || (
                <option disabled>Select a state first</option>
              )}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              When set, location will be relative to where this image is found at runtime
            </p>
          </div>
        )}

        {/* Screenshot Info */}
        {getScreenshot() && (
          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Screenshot
            </label>
            <div className="p-2 bg-gray-50 rounded">
              <p className="text-sm text-gray-600">{getScreenshot()?.name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {getScreenshot()?.width} × {getScreenshot()?.height} px
              </p>
            </div>
          </div>
        )}

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
                {location.screenshotId}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Location ID
              </label>
              <div className="px-2 py-1 bg-gray-50 rounded text-xs font-mono">
                {location.id}
              </div>
            </div>
          </div>
        </details>

        {/* Visual Preview */}
        <div className="border-t pt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Visual Preview
          </label>
          <div className="relative bg-gray-100 rounded p-4" style={{ minHeight: '100px' }}>
            {/* Base position */}
            <div
              className="absolute w-4 h-4 transform -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${(location.x / (getScreenshot()?.width || 1920)) * 100}%`,
                top: `${(location.y / (getScreenshot()?.height || 1080)) * 100}%`
              }}
            >
              <div className="relative">
                {/* Crosshair */}
                <div className="absolute w-4 h-0.5 bg-red-500 -translate-y-1/2 top-1/2"></div>
                <div className="absolute h-4 w-0.5 bg-red-500 -translate-x-1/2 left-1/2"></div>
                {/* Center dot */}
                <div className="absolute w-2 h-2 bg-red-600 rounded-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"></div>
              </div>
            </div>

            {/* Offset position if offsets are non-zero */}
            {(location.offsetX || location.offsetY) && (
              <div
                className="absolute w-4 h-4 transform -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${((location.x + (location.offsetX || 0)) / (getScreenshot()?.width || 1920)) * 100}%`,
                  top: `${((location.y + (location.offsetY || 0)) / (getScreenshot()?.height || 1080)) * 100}%`
                }}
              >
                <div className="relative">
                  {/* Crosshair with offset styling */}
                  <div className="absolute w-4 h-0.5 bg-blue-500 -translate-y-1/2 top-1/2"></div>
                  <div className="absolute h-4 w-0.5 bg-blue-500 -translate-x-1/2 left-1/2"></div>
                  {/* Center dot */}
                  <div className="absolute w-2 h-2 bg-blue-600 rounded-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"></div>
                </div>
              </div>
            )}

            <div className="text-center text-xs text-gray-500 mt-8">
              <div>Base: ({location.x}, {location.y})</div>
              {(location.offsetX || location.offsetY) && (
                <div className="text-blue-600">
                  Final: ({location.x + (location.offsetX || 0)}, {location.y + (location.offsetY || 0)})
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocationPropertiesPanel;
