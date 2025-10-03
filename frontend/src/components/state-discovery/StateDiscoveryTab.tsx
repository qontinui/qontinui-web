/**
 * State Discovery Tab Component
 * Main container for the State Discovery feature
 */

import React, { useState, useCallback, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, Play, Save, Download, AlertCircle, Filter, CropIcon } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import ScreenshotUploader from './ScreenshotUploader';
import VisualizationCanvas from './VisualizationCanvas';
import StateImageDetails from './StateImageDetails';
import StateDetails from './StateDetails';
import AnalysisProgress from './AnalysisProgress';
import RegionSelector from './RegionSelector';
import { useStateDiscovery } from '@/hooks/useStateDiscovery';
import { StateImage, DiscoveredState, AnalysisConfig } from '@/types/stateDiscovery';
import { useAutomation } from '@/contexts/automation-context';
import { createImageAsset, imageExistsInLibrary } from '@/lib/image-library-utils';
import { toast } from 'sonner';

const StateDiscoveryTab: React.FC = () => {
  // State management
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(0);
  const [selectedStateImage, setSelectedStateImage] = useState<StateImage | null>(null);
  const [selectedState, setSelectedState] = useState<DiscoveredState | null>(null);
  const [selectedStateImages, setSelectedStateImages] = useState<Set<string>>(new Set());
  const [highlightedStateImages, setHighlightedStateImages] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [viewMode, setViewMode] = useState<'all' | 'selected' | 'state'>('all');
  const [rightPanelTab, setRightPanelTab] = useState<'stateimage' | 'state'>('stateimage');
  const [maxDarkPixelPercentage, setMaxDarkPixelPercentage] = useState(85);
  const [maxLightPixelPercentage, setMaxLightPixelPercentage] = useState(85);
  const [canvasScale, setCanvasScale] = useState(1);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.95);
  const [canvasImageSize, setCanvasImageSize] = useState({ width: 0, height: 0 });
  const [selectedRegion, setSelectedRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [screenshotDimensions, setScreenshotDimensions] = useState({ width: 800, height: 600 });

  // Custom hook for State Discovery operations
  const {
    uploadScreenshots,
    startAnalysis,
    deleteStateImage,
    bulkDeleteStateImages,
    mergeStateImages,
    saveStructure,
    stateImages,
    states,
    analysisResult,
    uploadId,
    error
  } = useStateDiscovery();

  // Automation context for Image Library
  const { images, addImage } = useAutomation();

  // Create a memoized function to filter state images based on pixel percentages
  const getFilteredStateImages = useCallback(() => {
    if (!stateImages || stateImages.length === 0) return [];

    // Filter based on backend data if available
    return stateImages.filter(si => {
      // If backend provides pixel percentages, use those
      if (si.darkPixelPercentage !== undefined && si.lightPixelPercentage !== undefined) {
        const passedDarkFilter = si.darkPixelPercentage <= maxDarkPixelPercentage;
        const passedLightFilter = si.lightPixelPercentage <= maxLightPixelPercentage;
        return passedDarkFilter && passedLightFilter;
      }
      // If no backend data and filters are active, assume it won't pass
      // (backend should always provide this data after the fix)
      if (maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) {
        return false;
      }
      // Default to including when filters are at 100%
      return true;
    });
  }, [stateImages, maxDarkPixelPercentage, maxLightPixelPercentage]);

  // Create filtered states based on filtered state images
  const getFilteredStates = useCallback(() => {
    if (!states || states.length === 0) return [];

    const filteredStateImages = getFilteredStateImages();
    const filteredStateImageIds = new Set(filteredStateImages.map(si => si.id));

    // Filter states to only include those with at least one visible state image
    return states
      .map(state => ({
        ...state,
        // Update the stateImageIds to only include visible ones
        stateImageIds: state.stateImageIds?.filter(id => filteredStateImageIds.has(id)) || []
      }))
      .filter(state => state.stateImageIds.length > 0);
  }, [states, getFilteredStateImages]);

  // Use filtered versions
  const filteredStateImages = getFilteredStateImages();
  const filteredStates = getFilteredStates();

  // Create memoized image URL for selected screenshot
  const selectedScreenshotUrl = React.useMemo(() => {
    if (screenshots.length > 0 && selectedScreenshotIndex < screenshots.length) {
      return URL.createObjectURL(screenshots[selectedScreenshotIndex]);
    }
    return '';
  }, [screenshots, selectedScreenshotIndex]);

  // Load screenshot dimensions when selected screenshot changes
  React.useEffect(() => {
    if (selectedScreenshotUrl) {
      const img = new Image();
      img.onload = () => {
        setScreenshotDimensions({ width: img.width, height: img.height });
      };
      img.src = selectedScreenshotUrl;
    }
  }, [selectedScreenshotUrl]);

  // Reset selected state if it's been filtered out
  React.useEffect(() => {
    if (selectedState && !filteredStates.find(s => s.id === selectedState.id)) {
      setSelectedState(null);
    }
  }, [filteredStates, selectedState]);

  // Auto-highlight state images when a state is selected
  React.useEffect(() => {
    if (selectedState && rightPanelTab === 'state') {
      // Get all state image IDs for the selected state
      const stateImageIds = selectedState.stateImageIds || [];
      setHighlightedStateImages(stateImageIds);
    } else {
      setHighlightedStateImages([]);
    }
  }, [selectedState, rightPanelTab]);

  // Reset selected state image if it's been filtered out
  React.useEffect(() => {
    if (selectedStateImage && !filteredStateImages.find(si => si.id === selectedStateImage.id)) {
      setSelectedStateImage(null);
    }
  }, [filteredStateImages, selectedStateImage]);

  // Handle screenshot upload
  const handleScreenshotUpload = useCallback(async (files: File[]) => {
    // Validate file types
    const validExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp'];
    const validFiles = files.filter(file => {
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      return validExtensions.includes(ext);
    });

    if (validFiles.length === 0) {
      alert('Please upload valid image files (PNG, JPG, JPEG, GIF, or BMP)');
      return;
    }

    if (validFiles.length < files.length) {
      alert(`${files.length - validFiles.length} non-image files were skipped`);
    }

    setScreenshots(validFiles);
    try {
      await uploadScreenshots(validFiles);
    } catch (err) {
      console.error('Failed to upload screenshots:', err);
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [uploadScreenshots]);

  // Handle analysis start
  const handleStartAnalysis = useCallback(async () => {
    if (screenshots.length < 2) {
      alert('Please upload at least 2 screenshots');
      return;
    }

    // Check if upload was successful
    if (!uploadId) {
      alert('Screenshots need to be uploaded first. Please wait for upload to complete or try uploading again.');

      // Try to upload screenshots if they exist but weren't uploaded
      if (screenshots.length > 0) {
        try {
          // Attempting to upload screenshots
          await uploadScreenshots(screenshots);
        } catch (err) {
          console.error('Failed to upload screenshots:', err);
          alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          return;
        }
      } else {
        return;
      }
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);

    // Convert similarity threshold (0-1) to color tolerance (0-255)
    // Higher similarity = lower tolerance (more strict)
    // 0.95 similarity = 12.75 tolerance, 0.8 similarity = 51 tolerance
    const colorToleranceFromSimilarity = Math.round((1 - similarityThreshold) * 255);

    const config: AnalysisConfig = {
      minRegionSize: [20, 20],
      maxRegionSize: [500, 500],
      colorTolerance: colorToleranceFromSimilarity,  // Derived from similarity threshold
      stabilityThreshold: 0.98,
      varianceThreshold: 10,
      minScreenshotsPresent: 1,  // Find UI elements even if they appear once
      processingMode: 'full',
      enableRectangleDecomposition: true,
      enableCooccurrenceAnalysis: true,
      similarityThreshold: similarityThreshold,
      region: selectedRegion || undefined
    };

    try {
      await startAnalysis(
        config,
        (progress) => {
          setAnalysisProgress(progress.percentage);
        },
        () => {
          // Analysis completed
          setIsAnalyzing(false);
          setAnalysisProgress(100);
        }
      );
      // Don't show alert - the progress indicator shows the status
    } catch (err) {
      console.error('Analysis failed:', err);
      alert(`Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsAnalyzing(false);
    }
  }, [screenshots, uploadId, uploadScreenshots, startAnalysis]);

  // Handle StateImage selection
  const handleStateImageSelect = useCallback((stateImage: StateImage) => {
    setSelectedStateImage(stateImage);
  }, []);

  // Handle multi-select
  const handleStateImageMultiSelect = useCallback((stateImageId: string, ctrlKey: boolean) => {
    if (ctrlKey) {
      const newSelection = new Set(selectedStateImages);
      if (newSelection.has(stateImageId)) {
        newSelection.delete(stateImageId);
      } else {
        newSelection.add(stateImageId);
      }
      setSelectedStateImages(newSelection);
    } else {
      setSelectedStateImages(new Set([stateImageId]));
    }
  }, [selectedStateImages]);

  // Handle StateImage deletion
  const handleDeleteStateImage = useCallback(async () => {
    if (!selectedStateImage) return;

    const confirmed = window.confirm(
      `Delete StateImage "${selectedStateImage.name}"? This action cannot be undone.`
    );

    if (confirmed) {
      try {
        await deleteStateImage(selectedStateImage.id, { cascade: true });
        setSelectedStateImage(null);
      } catch (err) {
        console.error('Failed to delete StateImage:', err);
      }
    }
  }, [selectedStateImage, deleteStateImage]);

  // Handle bulk deletion
  const handleBulkDelete = useCallback(async () => {
    if (selectedStateImages.size === 0) return;

    const confirmed = window.confirm(
      `Delete ${selectedStateImages.size} StateImages? This action cannot be undone.`
    );

    if (confirmed) {
      try {
        await bulkDeleteStateImages(Array.from(selectedStateImages), {
          cascade: true,
          skipCritical: true
        });
        setSelectedStateImages(new Set());
        setSelectedStateImage(null);
      } catch (err) {
        console.error('Failed to delete StateImages:', err);
      }
    }
  }, [selectedStateImages, bulkDeleteStateImages]);

  // Handle save structure
  const handleSaveStructure = useCallback(async () => {
    const name = prompt('Enter a name for this state structure:');
    if (!name) return;

    // If filters are active, confirm with user
    if (maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) {
      const confirmed = window.confirm(
        `Filters are active. This will save only the ${filteredStates.length} filtered states ` +
        `and ${filteredStateImages.length} filtered state images. Continue?`
      );
      if (!confirmed) return;
    }

    try {
      // Save structure to backend
      await saveStructure(name);

      // Add discovered state images to Image Library
      let addedCount = 0;
      for (const stateImage of filteredStateImages) {
        // Check if stateImage has image data
        if (stateImage.image_data) {
          // Avoid duplicates
          if (!imageExistsInLibrary(images, stateImage.image_data)) {
            const imageAsset = createImageAsset(
              stateImage.image_data,
              stateImage.name || `StateImage_${stateImage.id}`,
              'state_discovery'
            );
            addImage(imageAsset);
            addedCount++;
          }
        }
      }

      toast.success(
        `State structure saved successfully! Added ${addedCount} images to Image Library.`
      );
    } catch (err) {
      console.error('Failed to save structure:', err);
      toast.error('Failed to save state structure');
    }
  }, [saveStructure, filteredStates, filteredStateImages, maxDarkPixelPercentage, maxLightPixelPercentage, images, addImage]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-2xl font-bold">State Discovery</h2>
        <div className="flex gap-2">
          <Button
            onClick={handleSaveStructure}
            disabled={!analysisResult || filteredStateImages.length === 0}
            variant={(maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) ? "secondary" : "default"}
          >
            <Save className="mr-2 h-4 w-4" />
            Save Structure
            {(maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) && (
              <Badge variant="outline" className="ml-1 text-xs">Filtered</Badge>
            )}
          </Button>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Screenshots */}
        <div className="w-64 border-r p-4 overflow-y-auto">
          <ScreenshotUploader
            onUpload={handleScreenshotUpload}
            screenshots={screenshots}
            selectedIndex={selectedScreenshotIndex}
            onSelectScreenshot={setSelectedScreenshotIndex}
          />

          {/* Similarity Threshold Slider */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Similarity Threshold</Label>
              <span className="text-sm text-gray-600">{similarityThreshold.toFixed(2)}</span>
            </div>
            <Slider
              value={[similarityThreshold]}
              onValueChange={([value]) => setSimilarityThreshold(value)}
              min={0}
              max={1}
              step={0.01}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>Loose (0.00)</span>
              <span>Strict (1.00)</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Lower values find more variations, higher values require exact matches
            </p>
          </div>

          {/* Region Selection Toggle */}
          {screenshots.length > 0 && (
            <div className="mt-4">
              <Button
                className="w-full"
                variant={showRegionSelector ? "secondary" : "outline"}
                onClick={() => setShowRegionSelector(!showRegionSelector)}
              >
                <CropIcon className="mr-2 h-4 w-4" />
                {showRegionSelector ? 'Hide' : 'Select'} Analysis Region
              </Button>

              {selectedRegion && (
                <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
                  <div className="font-medium">Selected Region:</div>
                  <div className="text-gray-600">
                    Position: ({selectedRegion.x}, {selectedRegion.y})
                  </div>
                  <div className="text-gray-600">
                    Size: {selectedRegion.width} × {selectedRegion.height}px
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full mt-1"
                    onClick={() => setSelectedRegion(null)}
                  >
                    Clear Selection
                  </Button>
                </div>
              )}
            </div>
          )}

          <Button
            className="w-full mt-4"
            onClick={handleStartAnalysis}
            disabled={screenshots.length < 2 || isAnalyzing}
            title={!uploadId ? "Upload screenshots first" : "Start analysis"}
          >
            <Play className="mr-2 h-4 w-4" />
            Run Analysis {selectedRegion ? '(Region)' : ''}
          </Button>

          {/* Upload status indicator */}
          {screenshots.length > 0 && (
            <div className="mt-2 text-xs text-center">
              {uploadId ? (
                <span className="text-green-600">✓ Screenshots uploaded</span>
              ) : (
                <span className="text-yellow-600">⚠ Upload pending...</span>
              )}
            </div>
          )}

          {/* Analysis Status */}
          {isAnalyzing && (
            <div className="mt-4">
              <Progress value={analysisProgress} className="mb-2" />
              <p className="text-sm text-gray-600">
                Analyzing... {analysisProgress}%
              </p>
            </div>
          )}

          {/* Statistics */}
          {analysisResult && (
            <Card className="mt-4">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Analysis Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  States: {filteredStates.length}
                  {filteredStates.length !== states?.length && (
                    <span className="text-gray-500"> (of {states?.length})</span>
                  )}
                </div>
                <div>
                  StateImages: {filteredStateImages.length}
                  {filteredStateImages.length !== stateImages?.length && (
                    <span className="text-gray-500"> (of {stateImages?.length})</span>
                  )}
                </div>
                <div>
                  Stability Score:{' '}
                  {analysisResult.statistics?.pixel_stability_score
                    ? (analysisResult.statistics.pixel_stability_score * 100).toFixed(1) + '%'
                    : 'N/A'}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick State Selector */}
          {filteredStates && filteredStates.length > 0 ? (
            <Card className="mt-4">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">
                  States ({filteredStates.length})
                  {filteredStates.length !== states?.length && (
                    <span className="text-gray-500 ml-1">(filtered)</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-48 overflow-y-auto">
                {filteredStates.map((state, index) => {
                  // State details available
                  return (
                    <button
                      key={state?.id || index}
                      className={cn(
                        "w-full text-left px-2 py-1 rounded text-sm hover:bg-gray-100",
                        selectedState?.id === state?.id && "bg-blue-100"
                      )}
                      onClick={() => {
                        // Selecting state
                        // Set the filtered state (which has updated stateImageIds)
                        setSelectedState(state);
                        setRightPanelTab('state');
                      }}
                    >
                      <div className="flex justify-between items-center">
                        <span className="truncate">{state?.name || 'Unnamed'}</span>
                        <span className="text-xs text-gray-500">
                          {state?.stateImageIds?.length || 0}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          ) : (
            <div className="mt-4 text-xs text-gray-500 text-center">
              No states found yet
            </div>
          )}

          {/* Pixel Filters */}
          {stateImages && stateImages.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center">
                    <Filter className="h-4 w-4 mr-2" />
                    Pixel Filters
                  </span>
                  {(maxDarkPixelPercentage < 100 || maxLightPixelPercentage < 100) && (
                    <Badge variant="secondary" className="text-xs">Active</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Dark Pixels Filter */}
                <div className="space-y-2">
                  <Label className="text-xs flex justify-between">
                    <span>Max Dark Pixels</span>
                    <span className="text-gray-500">{maxDarkPixelPercentage}%</span>
                  </Label>
                  <Slider
                    value={[maxDarkPixelPercentage]}
                    onValueChange={([value]) => setMaxDarkPixelPercentage(value)}
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500">
                    Hide regions with more than {maxDarkPixelPercentage}% dark pixels
                  </p>
                </div>

                {/* Light Pixels Filter */}
                <div className="space-y-2">
                  <Label className="text-xs flex justify-between">
                    <span>Max Light Pixels</span>
                    <span className="text-gray-500">{maxLightPixelPercentage}%</span>
                  </Label>
                  <Slider
                    value={[maxLightPixelPercentage]}
                    onValueChange={([value]) => setMaxLightPixelPercentage(value)}
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500">
                    Hide regions with more than {maxLightPixelPercentage}% light pixels
                  </p>
                </div>

                {/* Reset Button */}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setMaxDarkPixelPercentage(100);
                    setMaxLightPixelPercentage(100);
                  }}
                >
                  Reset Filters
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Center Panel - Visualization */}
        <div className="flex-1 p-4 overflow-hidden">
          <div className="h-full flex flex-col">
            {/* View Controls */}
            <div className="flex items-center gap-4 mb-4">
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
                <TabsList>
                  <TabsTrigger value="all">All StateImages</TabsTrigger>
                  <TabsTrigger value="selected">Selected Only</TabsTrigger>
                  <TabsTrigger value="state">Current State</TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Zoom controls */}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 hover:bg-gray-200 text-gray-700"
                  onClick={() => setCanvasScale(s => Math.max(s * 0.8, 0.1))}
                >
                  <span className="text-lg">−</span>
                </Button>
                <span className="text-sm font-medium px-2 text-gray-700">
                  {Math.round(canvasScale * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 hover:bg-gray-200 text-gray-700"
                  onClick={() => setCanvasScale(s => Math.min(s * 1.2, 3))}
                >
                  <span className="text-lg">+</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 hover:bg-gray-200 text-gray-700"
                  onClick={() => setCanvasScale(1)}
                >
                  Fit
                </Button>
              </div>

              {selectedStateImages.size > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-sm text-gray-600">
                    {selectedStateImages.size} selected
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedStateImages(new Set())}
                  >
                    Clear Selection
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkDelete}
                  >
                    Delete Selected
                  </Button>
                </div>
              )}
            </div>

            {/* Canvas or Region Selector - width adjusts based on zoom */}
            {showRegionSelector && selectedScreenshotUrl ? (
              <div className="flex-1">
                <RegionSelector
                  imageUrl={selectedScreenshotUrl}
                  imageWidth={screenshotDimensions.width}
                  imageHeight={screenshotDimensions.height}
                  onRegionSelect={setSelectedRegion}
                  initialRegion={selectedRegion}
                />
              </div>
            ) : (
              <div
                className="border rounded-lg overflow-auto bg-gray-50"
                style={{
                  flex: canvasScale < 0.8 ? '0 0 auto' : '1',
                  width: canvasScale < 0.8 ? `${canvasImageSize.width * canvasScale + 40}px` : undefined,
                  minWidth: '300px'
                }}
              >
                {screenshots.length > 0 ? (
                  <VisualizationCanvas
                    screenshot={screenshots[selectedScreenshotIndex]}
                    stateImages={stateImages}  // Pass all state images for pixel analysis
                    selectedStateImage={selectedStateImage}
                    selectedStateImages={selectedStateImages}
                    highlightedStateImages={highlightedStateImages}
                    viewMode={viewMode}
                    onSelectStateImage={handleStateImageSelect}
                    onMultiSelectStateImage={handleStateImageMultiSelect}
                    screenshotIndex={selectedScreenshotIndex}
                    maxDarkPixelPercentage={maxDarkPixelPercentage}
                    maxLightPixelPercentage={maxLightPixelPercentage}
                    scale={canvasScale}
                    onScaleChange={setCanvasScale}
                    onImageSizeChange={setCanvasImageSize}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400">
                    <div className="text-center">
                      <Upload className="h-12 w-12 mx-auto mb-4" />
                      <p>Upload screenshots to begin</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Details */}
        <div className="w-80 border-l overflow-hidden flex flex-col">
          <Tabs value={rightPanelTab} onValueChange={(v) => setRightPanelTab(v as 'stateimage' | 'state')} className="flex flex-col h-full">
            <div className="border-b px-4 pt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="stateimage">StateImages</TabsTrigger>
                <TabsTrigger value="state">States</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="stateimage" className="flex-1 overflow-y-auto px-4 pb-4 mt-0">
              {selectedStateImage ? (
                <StateImageDetails
                  stateImage={selectedStateImage}
                  screenshots={screenshots}
                  states={filteredStates}  // Use filtered states
                  onUpdate={(updates) => {
                    // Handle StateImage updates
                    // Update StateImage
                  }}
                  onDelete={handleDeleteStateImage}
                  onMerge={() => {
                    // Handle merge
                    // Merge StateImage
                  }}
                />
              ) : (
                <div className="text-center text-gray-400 mt-8">
                  <p>Select a StateImage to view details</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="state" className="flex-1 overflow-y-auto px-4 pb-4 mt-0">
              {selectedState ? (() => {
                // Find the filtered version of the selected state
                const filteredSelectedState = filteredStates.find(s => s.id === selectedState.id) || selectedState;
                return (
                  <StateDetails
                    state={filteredSelectedState}
                    stateImages={filteredStateImages}  // Use filtered state images
                    screenshots={screenshots}
                    currentScreenshotIndex={selectedScreenshotIndex}
                    onSelectScreenshot={(index) => {
                      setSelectedScreenshotIndex(index);
                      // Don't highlight all state images, let StateDetails handle filtering
                    }}
                    onHighlightStateImages={setHighlightedStateImages}
                  />
                );
              })() : (
                <div className="text-center text-gray-400 mt-8">
                  <p>Select a State to view details</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <Alert className="m-4" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Progress Modal */}
      {isAnalyzing && (
        <AnalysisProgress
          progress={analysisProgress}
          onCancel={() => setIsAnalyzing(false)}
        />
      )}
    </div>
  );
};

export default StateDiscoveryTab;
