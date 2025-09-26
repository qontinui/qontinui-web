import React, { useState, useRef } from 'react';
import { Upload, Image, MousePointer, Square, Eye, Download, Trash2 } from 'lucide-react';
import { Screenshot, SelectionMode, ScreenshotRegion, ScreenshotLocation } from '../../types/Screenshot';
import ScreenshotCanvas from './ScreenshotCanvas';
import RegionPropertiesPanel from './RegionPropertiesPanel';
import LocationPropertiesPanel from './LocationPropertiesPanel';
import StateAssociationPanel from './StateAssociationPanel';
import { generateId } from '../../lib/utils';

interface ScreenshotUploadTabProps {
  states: any[]; // Will be replaced with proper State type
  onExport: (screenshots: Screenshot[]) => void;
}

const ScreenshotUploadTab: React.FC<ScreenshotUploadTabProps> = ({
  states,
  onExport
}) => {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('view');
  const [selectedRegion, setSelectedRegion] = useState<ScreenshotRegion | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<ScreenshotLocation | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new window.Image();
          img.onload = () => {
            const screenshot: Screenshot = {
              id: generateId(),
              name: file.name,
              imageData: e.target?.result as string,
              width: img.width,
              height: img.height,
              uploadedAt: new Date(),
              associatedStates: [],
              regions: [],
              locations: []
            };
            setScreenshots(prev => [...prev, screenshot]);
            if (!selectedScreenshot) {
              setSelectedScreenshot(screenshot);
            }
          };
          img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleRegionCreate = (region: ScreenshotRegion) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      regions: [...selectedScreenshot.regions, region]
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
    setSelectedRegion(region);
  };

  const handleLocationCreate = (location: ScreenshotLocation) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      locations: [...selectedScreenshot.locations, location]
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
    setSelectedLocation(location);
  };

  const handleRegionUpdate = (updatedRegion: ScreenshotRegion) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      regions: selectedScreenshot.regions.map(r =>
        r.id === updatedRegion.id ? updatedRegion : r
      )
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
    setSelectedRegion(updatedRegion);
  };

  const handleRegionDelete = (regionId: string) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      regions: selectedScreenshot.regions.filter(r => r.id !== regionId)
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
    setSelectedRegion(null);
  };

  const handleLocationUpdate = (updatedLocation: ScreenshotLocation) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      locations: selectedScreenshot.locations.map(l =>
        l.id === updatedLocation.id ? updatedLocation : l
      )
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
    setSelectedLocation(updatedLocation);
  };

  const handleLocationDelete = (locationId: string) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      locations: selectedScreenshot.locations.filter(l => l.id !== locationId)
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
    setSelectedLocation(null);
  };

  const handleStateAssociation = (stateIds: string[]) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      associatedStates: stateIds
    };

    setScreenshots(prev => prev.map(s =>
      s.id === selectedScreenshot.id ? updatedScreenshot : s
    ));
    setSelectedScreenshot(updatedScreenshot);
  };

  const handleDeleteScreenshot = (screenshotId: string) => {
    setScreenshots(prev => prev.filter(s => s.id !== screenshotId));
    if (selectedScreenshot?.id === screenshotId) {
      setSelectedScreenshot(screenshots.find(s => s.id !== screenshotId) || null);
    }
  };

  const handleExportAll = () => {
    onExport(screenshots);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Upload className="w-4 h-4" />
            Upload Screenshots
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-2 rounded-md ${selectionMode === 'view' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
            onClick={() => setSelectionMode('view')}
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            className={`px-3 py-2 rounded-md ${selectionMode === 'region' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
            onClick={() => setSelectionMode('region')}
          >
            <Square className="w-4 h-4" />
          </button>
          <button
            className={`px-3 py-2 rounded-md ${selectionMode === 'location' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
            onClick={() => setSelectionMode('location')}
          >
            <MousePointer className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleExportAll}
          disabled={screenshots.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Configuration
        </button>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Screenshot List */}
        <div className="w-64 border-r bg-gray-50 overflow-y-auto">
          <div className="p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Screenshots ({screenshots.length})</h3>
            <div className="space-y-2">
              {screenshots.map(screenshot => (
                <div
                  key={screenshot.id}
                  className={`group relative p-2 bg-white rounded-md cursor-pointer hover:shadow-md transition-shadow ${
                    selectedScreenshot?.id === screenshot.id ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => setSelectedScreenshot(screenshot)}
                >
                  <div className="aspect-video relative overflow-hidden rounded bg-gray-100">
                    <img
                      src={screenshot.imageData}
                      alt={screenshot.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <p className="mt-1 text-xs font-medium truncate">{screenshot.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {screenshot.associatedStates.map(stateId => {
                      const state = states.find(s => s.id === stateId);
                      return state ? (
                        <span key={stateId} className="inline-block px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                          {state.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteScreenshot(screenshot.id);
                    }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 bg-red-500 text-white rounded hover:bg-red-600 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedScreenshot ? (
            <>
              <ScreenshotCanvas
                screenshot={selectedScreenshot}
                selectionMode={selectionMode}
                onRegionCreate={handleRegionCreate}
                onLocationCreate={handleLocationCreate}
                onRegionSelect={setSelectedRegion}
                onLocationSelect={setSelectedLocation}
              />
              <StateAssociationPanel
                screenshot={selectedScreenshot}
                states={states}
                onStateAssociation={handleStateAssociation}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Image className="w-12 h-12 mx-auto mb-2" />
                <p>Upload screenshots to begin</p>
              </div>
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {selectedRegion && (
          <RegionPropertiesPanel
            selectedRegion={selectedRegion}
            states={states}
            screenshots={screenshots}
            onUpdate={handleRegionUpdate}
            onDelete={handleRegionDelete}
          />
        )}
        {selectedLocation && !selectedRegion && (
          <LocationPropertiesPanel
            selectedLocation={selectedLocation}
            states={states}
            screenshots={screenshots}
            onUpdate={handleLocationUpdate}
            onDelete={handleLocationDelete}
          />
        )}
      </div>
    </div>
  );
};

export default ScreenshotUploadTab;
