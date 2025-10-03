import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image, Download, Trash2, Edit2, Check, X } from 'lucide-react';
import { Screenshot } from '../../types/Screenshot';
import { generateId } from '../../lib/utils';
import { downloadStateExport, downloadPythonStateCode } from '../../lib/state-exporter';
import { useAutomation } from '../../contexts/automation-context';

interface ScreenshotUploadTabProps {
  states: any[]; // Will be replaced with proper State type
  onExport: (screenshots: Screenshot[]) => void;
}

const ScreenshotUploadTab: React.FC<ScreenshotUploadTabProps> = ({
  states,
  onExport
}) => {
  const { screenshots: projectScreenshots, addScreenshot, updateScreenshot, deleteScreenshot: removeScreenshot } = useAutomation();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);

  // Sync local screenshots with project screenshots
  useEffect(() => {
    // Convert project screenshots to the Screenshot type used by this component
    // Load each image to get its dimensions
    const loadScreenshots = async () => {
      const convertedScreenshots: Screenshot[] = await Promise.all(
        projectScreenshots.map(ps =>
          new Promise<Screenshot>((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              resolve({
                id: ps.id,
                name: ps.name,
                imageData: ps.url,
                width: img.width,
                height: img.height,
                uploadedAt: ps.uploadedAt,
                associatedStates: [],
                regions: [],
                locations: []
              });
            };
            img.onerror = () => {
              // Fallback if image fails to load
              resolve({
                id: ps.id,
                name: ps.name,
                imageData: ps.url,
                width: 0,
                height: 0,
                uploadedAt: ps.uploadedAt,
                associatedStates: [],
                regions: [],
                locations: []
              });
            };
            img.src = ps.url;
          })
        )
      );
      setScreenshots(convertedScreenshots);
    };

    loadScreenshots();
  }, [projectScreenshots]);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [editingScreenshotId, setEditingScreenshotId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [zoomMode, setZoomMode] = useState<'fit' | 'original'>('fit');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) {
          alert(`Invalid file type: ${file.name} is not an image file.`);
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new window.Image();
          img.onload = () => {
            // Validate image dimensions
            if (img.width < 10 || img.height < 10) {
              alert(`Image too small: ${file.name} is ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`);
              return;
            }

            // Remove file extension from name
            const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, '');

            // Save to project via automation context
            const projectScreenshot = {
              id: generateId(),
              name: nameWithoutExtension,
              url: e.target?.result as string,
              size: file.size,
              uploadedAt: new Date(),
            };
            addScreenshot(projectScreenshot);

            // Also keep local state for compatibility
            const screenshot: Screenshot = {
              id: projectScreenshot.id,
              name: nameWithoutExtension,
              imageData: e.target?.result as string,
              width: img.width,
              height: img.height,
              uploadedAt: new Date(),
              associatedStates: [],
              regions: [],
              locations: []
            };

            if (!selectedScreenshot) {
              setSelectedScreenshot(screenshot);
            }
          };
          img.onerror = () => {
            alert(`Failed to load image: ${file.name} could not be processed.`);
          };
          img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
      });
    }
  };


  const handleDeleteScreenshot = (screenshotId: string) => {
    // Delete from project
    removeScreenshot(screenshotId);

    // Update local state
    if (selectedScreenshot?.id === screenshotId) {
      setSelectedScreenshot(screenshots.find(s => s.id !== screenshotId) || null);
    }
  };

  const handleStartEdit = (screenshot: Screenshot) => {
    setEditingScreenshotId(screenshot.id);
    setEditingName(screenshot.name);
  };

  const handleCancelEdit = () => {
    setEditingScreenshotId(null);
    setEditingName('');
  };

  const handleSaveEdit = () => {
    if (!editingScreenshotId || !editingName.trim()) {
      handleCancelEdit();
      return;
    }

    // Find the screenshot in project screenshots
    const projectScreenshot = projectScreenshots.find(s => s.id === editingScreenshotId);
    if (projectScreenshot) {
      // Update in automation context
      updateScreenshot({
        ...projectScreenshot,
        name: editingName.trim()
      });
    }

    // Update selected screenshot if it's the one being edited
    if (selectedScreenshot?.id === editingScreenshotId) {
      setSelectedScreenshot({
        ...selectedScreenshot,
        name: editingName.trim()
      });
    }

    handleCancelEdit();
  };

  const handleExportAll = () => {
    onExport(screenshots);
  };

  const handleExportJson = () => {
    downloadStateExport(states, screenshots);
    setShowExportMenu(false);
  };

  const handleExportPython = () => {
    downloadPythonStateCode(states, screenshots);
    setShowExportMenu(false);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center p-4 border-b bg-white flex-shrink-0">
        {/* Left section - Upload button */}
        <div className="w-64 flex-shrink-0">
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

        {/* Middle section - Zoom button aligned with canvas */}
        <div className="flex-1 flex items-center gap-2">
          {selectedScreenshot && (
            <button
              onClick={() => setZoomMode(zoomMode === 'fit' ? 'original' : 'fit')}
              className={`px-4 py-2 rounded-md border text-sm font-medium ${
                zoomMode === 'fit'
                  ? 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  : 'bg-gray-700 text-white border-gray-700 hover:bg-gray-800'
              }`}
            >
              {zoomMode === 'fit' ? 'Original Size (1:1)' : 'Fit to Screen'}
            </button>
          )}
        </div>

        {/* Right section - Export button */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={screenshots.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export
          </button>

          {/* Export Menu Dropdown */}
          {showExportMenu && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg z-10 border">
              <div className="py-1">
                <button
                  onClick={handleExportJson}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                >
                  <FileJson className="w-4 h-4" />
                  Export as JSON
                  <span className="text-xs text-gray-500 ml-auto">qontinui</span>
                </button>
                <button
                  onClick={handleExportPython}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                >
                  <FileCode className="w-4 h-4" />
                  Export as Python Code
                </button>
                <div className="border-t my-1"></div>
                <button
                  onClick={handleExportAll}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Raw Data
                  <span className="text-xs text-gray-500 ml-auto">debug</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Screenshot List */}
        <div className="w-64 border-r bg-gray-50 overflow-y-auto flex-shrink-0">
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

                  {/* Name editing */}
                  {editingScreenshotId === screenshot.id ? (
                    <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSaveEdit();
                          } else if (e.key === 'Escape') {
                            handleCancelEdit();
                          }
                        }}
                        className="flex-1 text-xs px-1 py-0.5 border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveEdit}
                        className="p-0.5 bg-green-500 text-white rounded hover:bg-green-600"
                        title="Save (Enter)"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-0.5 bg-gray-400 text-white rounded hover:bg-gray-500"
                        title="Cancel (Esc)"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-1">
                      <p className="flex-1 text-xs font-medium truncate text-gray-900">{screenshot.name}</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(screenshot);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-blue-600 transition-opacity"
                        title="Edit name"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}

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
            <div className="flex-1 bg-gray-100 overflow-auto min-h-0">
              <div className="p-5 h-full">
                <div className="relative inline-block">
                  <img
                    src={selectedScreenshot.imageData}
                    alt={selectedScreenshot.name}
                    className="border border-gray-300 shadow-lg bg-white"
                    style={{
                      maxWidth: zoomMode === 'fit' ? '100%' : 'none',
                      height: 'auto'
                    }}
                  />
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                    <span>{selectedScreenshot.width} x {selectedScreenshot.height}px</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Image className="w-12 h-12 mx-auto mb-2" />
                <p>Upload screenshots to begin</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScreenshotUploadTab;
