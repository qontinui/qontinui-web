import React, { useState, useRef, useEffect } from 'react';
import { Upload, Image, Download, Trash2, Edit2, Check, X, FileJson, FileCode } from 'lucide-react';
import { Screenshot } from '../../types/Screenshot';
import { generateId } from '../../lib/utils';
import { downloadStateExport, downloadPythonStateCode } from '../../lib/state-exporter';
import { useAutomation } from '../../contexts/automation-context';
import {
  QontinuiPage,
  QontinuiHeader,
  QontinuiHeaderActions,
  QontinuiMain,
  QontinuiSidebar,
  UploadButton,
  CreateButton,
  GhostButton,
  QontinuiCard,
  QontinuiInput,
} from '../qontinui';

interface ScreenshotUploadTabProps {
  states: any[];
  onExport: (screenshots: Screenshot[]) => void;
}

const ScreenshotUploadTab: React.FC<ScreenshotUploadTabProps> = ({
  states,
  onExport
}) => {
  const { screenshots: projectScreenshots, addScreenshot, updateScreenshot, deleteScreenshot: removeScreenshot } = useAutomation();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [editingScreenshotId, setEditingScreenshotId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [zoomMode, setZoomMode] = useState<'fit' | 'original'>('fit');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local screenshots with project screenshots
  useEffect(() => {
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
            if (img.width < 10 || img.height < 10) {
              alert(`Image too small: ${file.name} is ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`);
              return;
            }

            const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, '');
            const projectScreenshot = {
              id: generateId(),
              name: nameWithoutExtension,
              url: e.target?.result as string,
              size: file.size,
              uploadedAt: new Date(),
            };
            addScreenshot(projectScreenshot);

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
    removeScreenshot(screenshotId);
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

    const projectScreenshot = projectScreenshots.find(s => s.id === editingScreenshotId);
    if (projectScreenshot) {
      updateScreenshot({
        ...projectScreenshot,
        name: editingName.trim()
      });
    }

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
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-[#0A0A0B]">
      {/* Toolbar */}
      <QontinuiHeader>
        <div className="flex items-center justify-between w-full">
          {/* Upload button */}
          <UploadButton onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4" />
            Upload Screenshots
          </UploadButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Zoom controls */}
          <div className="flex-1 flex items-center justify-center gap-2">
            {selectedScreenshot && (
              <GhostButton
                onClick={() => setZoomMode(zoomMode === 'fit' ? 'original' : 'fit')}
                size="sm"
              >
                {zoomMode === 'fit' ? 'Original Size (1:1)' : 'Fit to Screen'}
              </GhostButton>
            )}
          </div>

          {/* Export button */}
          <QontinuiHeaderActions>
            <div className="relative">
              <CreateButton
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={screenshots.length === 0}
              >
                <Download className="w-4 h-4" />
                Export
              </CreateButton>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-[#27272A] rounded-md shadow-lg z-10 border border-gray-700">
                  <div className="py-1">
                    <button
                      onClick={handleExportJson}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                    >
                      <FileJson className="w-4 h-4" />
                      Export as JSON
                      <span className="text-xs text-gray-500 ml-auto">qontinui</span>
                    </button>
                    <button
                      onClick={handleExportPython}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                    >
                      <FileCode className="w-4 h-4" />
                      Export as Python Code
                    </button>
                    <div className="border-t border-gray-700 my-1"></div>
                    <button
                      onClick={handleExportAll}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Export Raw Data
                      <span className="text-xs text-gray-500 ml-auto">debug</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </QontinuiHeaderActions>
        </div>
      </QontinuiHeader>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Screenshot List Sidebar */}
        <QontinuiSidebar className="overflow-y-auto">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            Screenshots ({screenshots.length})
          </h3>

          <div className="space-y-2">
            {screenshots.map(screenshot => (
              <QontinuiCard
                key={screenshot.id}
                selected={selectedScreenshot?.id === screenshot.id}
                hoverable
                onClick={() => setSelectedScreenshot(screenshot)}
                className="group cursor-pointer p-2"
              >
                {/* Thumbnail */}
                <div className="aspect-video relative overflow-hidden rounded bg-[#0A0A0B]">
                  <img
                    src={screenshot.imageData}
                    alt={screenshot.name}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Name editing */}
                {editingScreenshotId === screenshot.id ? (
                  <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <QontinuiInput
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveEdit();
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      className="flex-1 text-xs"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-1 bg-[#00FF88] text-black rounded hover:bg-[#00FF88]/90"
                      title="Save (Enter)"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 bg-gray-600 text-white rounded hover:bg-gray-500"
                      title="Cancel (Esc)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1">
                    <p className="flex-1 text-xs font-medium truncate text-gray-300">
                      {screenshot.name}
                    </p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(screenshot);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-[#00D9FF] transition-opacity"
                      title="Edit name"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteScreenshot(screenshot.id);
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-red-500/90 text-white rounded hover:bg-red-600 transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </QontinuiCard>
            ))}
          </div>
        </QontinuiSidebar>

        {/* Canvas Area */}
        <QontinuiMain>
          {selectedScreenshot ? (
            <div className="p-6 h-full">
              <div className="relative inline-block">
                <img
                  src={selectedScreenshot.imageData}
                  alt={selectedScreenshot.name}
                  className="border border-gray-700 shadow-lg bg-[#27272A]"
                  style={{
                    maxWidth: zoomMode === 'fit' ? '100%' : 'none',
                    height: 'auto'
                  }}
                />
                <div className="absolute bottom-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                  <span>{selectedScreenshot.width} x {selectedScreenshot.height}px</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Image className="w-12 h-12 mx-auto mb-2" />
                <p>Upload screenshots to begin</p>
              </div>
            </div>
          )}
        </QontinuiMain>
      </div>
    </div>
  );
};

export default ScreenshotUploadTab;
