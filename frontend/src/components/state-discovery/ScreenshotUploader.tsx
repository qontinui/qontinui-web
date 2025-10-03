/**
 * Screenshot Uploader Component
 * Handles screenshot upload and thumbnail display
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { Upload, X, Image as ImageIcon, Save, FolderOpen, AlertCircle } from 'lucide-react';
import { calculateImageHashes, filterDuplicateImages } from '@/utils/imageUtils';
import ProjectScreenshotSelector from './ProjectScreenshotSelector';

interface ScreenshotUploaderProps {
  onUpload: (files: File[]) => void;
  screenshots: File[];
  selectedIndex: number;
  onSelectScreenshot: (index: number) => void;
}

const ScreenshotUploader: React.FC<ScreenshotUploaderProps> = ({
  onUpload,
  screenshots,
  selectedIndex,
  onSelectScreenshot
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [thumbnails, setThumbnails] = useState<{ [key: string]: string }>({});
  const [screenshotHashes, setScreenshotHashes] = useState<Map<string, string>>(new Map());
  const [projectHashes, setProjectHashes] = useState<string[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [showProjectSelector, setShowProjectSelector] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);

  // Load project screenshot hashes on mount
  useEffect(() => {
    const loadProjectHashes = async () => {
      try {
        const projectId = 'default';
        const response = await fetch(`http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`);

        if (response.ok) {
          const data = await response.json();
          const hashes = data.screenshots.map((s: any) => s.hash);
          setProjectHashes(hashes);
        }
      } catch (error) {
        console.error('Failed to load project hashes:', error);
      }
    };

    loadProjectHashes();
  }, []);

  // Generate thumbnails for uploaded files
  useEffect(() => {
    const generateThumbnails = async () => {
      const newThumbnails: { [key: string]: string } = {};

      for (const file of screenshots) {
        if (file.type.startsWith('image/')) {
          try {
            // Create a unique key for this file
            const key = `${file.name}_${file.size}_${file.lastModified}`;

            // Check if we already have this thumbnail
            if (thumbnails[key]) {
              newThumbnails[key] = thumbnails[key];
              continue;
            }

            // Create object URL for the image
            const url = URL.createObjectURL(file);
            newThumbnails[key] = url;
          } catch (error) {
            console.error('Failed to generate thumbnail:', error);
          }
        }
      }

      // Clean up old URLs that are no longer needed
      Object.entries(thumbnails).forEach(([key, url]) => {
        if (!newThumbnails[key]) {
          URL.revokeObjectURL(url);
        }
      });

      setThumbnails(newThumbnails);
    };

    generateThumbnails();
  }, [screenshots]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Revoke all object URLs when component unmounts
      Object.values(thumbnails).forEach(url => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  // Load saved project screenshots on mount
  useEffect(() => {
    const loadProjectScreenshots = async () => {
      try {
        const projectId = 'default';
        const response = await fetch(`http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`);
        if (response.ok) {
          const data = await response.json();
          console.log('[ScreenshotUploader] Loading saved screenshots:', data.screenshots.length);
          // Just notify the user that saved screenshots are available
          if (screenshots.length === 0 && data.screenshots.length > 0) {
            setSaveMessage({
              type: 'info',
              text: `${data.screenshots.length} saved screenshot(s) available. Use "Load from Project" to restore them.`
            });
          }
        }
      } catch (error) {
        console.error('Failed to check for saved screenshots:', error);
      }
    };
    loadProjectScreenshots();
  }, []); // Only on mount

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onUpload(files);
    }
  }, [onUpload]);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(
      file => file.type.startsWith('image/')
    );
    if (files.length > 0) {
      onUpload(files);
    }
  }, [onUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Remove screenshot
  const handleRemove = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newScreenshots = screenshots.filter((_, i) => i !== index);
    onUpload(newScreenshots);
  }, [screenshots, onUpload]);

  // Calculate hashes when screenshots change
  useEffect(() => {
    const calculateHashes = async () => {
      if (screenshots.length > 0) {
        const hashes = await calculateImageHashes(screenshots);
        setScreenshotHashes(hashes);

        // Check for duplicates against project hashes
        let duplicates = 0;
        hashes.forEach((hash) => {
          if (projectHashes.includes(hash)) {
            duplicates++;
          }
        });
        setDuplicateCount(duplicates);
      }
    };

    calculateHashes();
  }, [screenshots, projectHashes]);

  // Handle saving screenshots to project
  const handleSaveToProject = async () => {
    if (screenshots.length === 0) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      // Create FormData with screenshots
      const formData = new FormData();
      screenshots.forEach((file) => {
        formData.append('files', file);
      });

      // Use default project ID for now
      const projectId = 'default';

      // Call actual API to save screenshots
      const response = await fetch(`http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to save screenshots');
      }

      const result = await response.json();

      // Update message based on result
      if (result.total_saved === 0) {
        setSaveMessage({
          type: 'error',
          text: `All ${result.total_duplicates} screenshot(s) already exist in the project.`
        });
      } else {
        setSaveMessage({
          type: 'success',
          text: `Saved ${result.total_saved} screenshot(s) to project.${result.total_duplicates > 0 ? ` ${result.total_duplicates} duplicate(s) skipped.` : ''}`
        });

        // Reload project hashes to include newly saved screenshots
        const hashResponse = await fetch(`http://localhost:8000/api/state-discovery/project/${projectId}/screenshots`);
        if (hashResponse.ok) {
          const hashData = await hashResponse.json();
          const updatedHashes = hashData.screenshots.map((s: any) => s.hash);
          setProjectHashes(updatedHashes);
        }
      }
    } catch (error) {
      console.error('Failed to save screenshots:', error);
      setSaveMessage({
        type: 'error',
        text: 'Failed to save screenshots to project.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle selecting project screenshots
  const handleSelectProjectScreenshots = async (selected: any[]) => {
    // Convert project screenshots to File objects
    // Selected project screenshots

    try {
      const projectId = 'default';
      const newFiles: File[] = [];

      for (const screenshot of selected) {
        // Fetch the full screenshot data
        const response = await fetch(`http://localhost:8000/api/state-discovery/project/${projectId}/screenshots/${screenshot.id}`);

        if (!response.ok) {
          console.error(`Failed to load screenshot ${screenshot.name}`);
          continue;
        }

        const data = await response.json();

        // Convert base64 to File
        const base64Data = data.image_data.split(',')[1]; // Remove data:image/png;base64, prefix
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'image/png' });
        const file = new File([blob], screenshot.name, { type: 'image/png' });

        newFiles.push(file);
      }

      // Add to existing screenshots
      if (newFiles.length > 0) {
        onUpload([...screenshots, ...newFiles]);
      }
    } catch (error) {
      console.error('Failed to load project screenshots:', error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-sm">Screenshots</h3>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            Upload
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowProjectSelector(true)}
          >
            <FolderOpen className="mr-1 h-4 w-4" />
            From Project
          </Button>
        </div>

        {/* Save to Project Button */}
        {screenshots.length > 0 && (
          <Button
            className="w-full"
            size="sm"
            onClick={handleSaveToProject}
            disabled={isSaving || screenshots.length === 0}
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save to Project'}
          </Button>
        )}

        {/* Duplicate Warning */}
        {duplicateCount > 0 && (
          <Alert className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {duplicateCount} screenshot{duplicateCount !== 1 ? 's' : ''} already in project
            </AlertDescription>
          </Alert>
        )}

        {/* Save Message */}
        {saveMessage && (
          <Alert className={`py-2 ${
            saveMessage.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : saveMessage.type === 'info'
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-green-200 bg-green-50 text-green-700'
          }`}>
            <AlertDescription className="text-xs">
              {saveMessage.text}
            </AlertDescription>
          </Alert>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Drop Zone */}
      {screenshots.length === 0 && (
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <ImageIcon className="mx-auto h-12 w-12 text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">
            Drag and drop images here
          </p>
          <p className="text-xs text-gray-500 mt-1">
            PNG, JPG up to 50MB
          </p>
        </div>
      )}

      {/* Screenshot List */}
      {screenshots.length > 0 && (
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {screenshots.map((file, index) => (
              <div
                key={index}
                className={cn(
                  "relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all",
                  selectedIndex === index
                    ? "border-blue-500 shadow-md"
                    : "border-gray-200 hover:border-gray-300"
                )}
                onClick={() => onSelectScreenshot(index)}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
                  {(() => {
                    const key = `${file.name}_${file.size}_${file.lastModified}`;
                    const thumbnailUrl = thumbnails[key];

                    if (thumbnailUrl) {
                      return (
                        <img
                          src={thumbnailUrl}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                      );
                    } else {
                      return <ImageIcon className="h-8 w-8 text-gray-400" />;
                    }
                  })()}
                </div>

                {/* Filename */}
                <div className="p-2">
                  <p className="text-xs truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>

                {/* Remove button */}
                <button
                  className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => handleRemove(index, e)}
                >
                  <X className="h-3 w-3" />
                </button>

                {/* Selection indicator */}
                {selectedIndex === index && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-blue-500" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Screenshot count */}
      {screenshots.length > 0 && (
        <p className="text-xs text-gray-500 text-center">
          {screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''} uploaded
        </p>
      )}

      {/* Project Screenshot Selector Dialog */}
      <ProjectScreenshotSelector
        isOpen={showProjectSelector}
        onClose={() => setShowProjectSelector(false)}
        onSelect={handleSelectProjectScreenshots}
        currentHashes={Array.from(screenshotHashes.values())}
      />
    </div>
  );
};

export default ScreenshotUploader;
