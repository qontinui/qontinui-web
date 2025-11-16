/**
 * Enhanced Image Library - Example Usage
 *
 * Demonstrates how to use the Enhanced Image Library component
 */

"use client";

import React from 'react';
import { EnhancedImageLibrary } from './EnhancedImageLibrary';

/**
 * Example 1: Basic Usage
 *
 * The simplest way to use the Enhanced Image Library.
 * It automatically connects to AutomationContext.
 */
export function BasicExample() {
  return (
    <div className="h-screen">
      <EnhancedImageLibrary />
    </div>
  );
}

/**
 * Example 2: In a Tab Layout
 *
 * Using the Image Library as part of a tabbed interface.
 */
export function TabExample() {
  return (
    <div className="h-screen flex flex-col">
      <header className="p-4 border-b">
        <h1 className="text-2xl font-bold">Project Assets</h1>
      </header>

      <div className="flex-1 overflow-hidden">
        <EnhancedImageLibrary />
      </div>
    </div>
  );
}

/**
 * Example 3: With Custom Organization Hook
 *
 * Using the organization hook separately for custom UI.
 */
import { useImageOrganization } from './useImageOrganization';
import { useAutomation } from '@/contexts/automation-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function CustomOrganizationExample() {
  const { images, updateImage } = useAutomation();

  const {
    folders,
    folderTree,
    createFolder,
    collections,
    createCollection,
    currentFilter,
    setCurrentFilter,
    selectedImageIds,
    toggleImageSelection,
    clearSelection,
  } = useImageOrganization({
    images: images.map(img => ({ ...img, folderId: (img as any).folderId, tags: (img as any).tags || [] })),
    onUpdateImage: updateImage as any,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold">Custom Image Organization</h2>
        <Badge>{folders.length} folders</Badge>
        <Badge>{collections.length} collections</Badge>
        <Badge>{selectedImageIds.size} selected</Badge>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => createFolder('New Folder', null, '#3b82f6')}>
          Create Folder
        </Button>
        <Button onClick={() => createCollection('New Collection')}>
          Create Collection
        </Button>
        {selectedImageIds.size > 0 && (
          <Button variant="outline" onClick={clearSelection}>
            Clear Selection
          </Button>
        )}
      </div>

      {/* Your custom UI here */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Folders</h3>
          <div className="space-y-1">
            {folderTree.map(folder => (
              <div key={folder.id} className="flex items-center justify-between text-sm">
                <span>{folder.name}</span>
                <Badge variant="outline">{folder.totalImageCount}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Collections</h3>
          <div className="space-y-1">
            {collections.map(collection => (
              <div key={collection.id} className="flex items-center justify-between text-sm">
                <span>{collection.name}</span>
                <Badge variant="outline">{collection.imageIds.length}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Filters</h3>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Search..."
              value={currentFilter.query || ''}
              onChange={(e) => setCurrentFilter({ ...currentFilter, query: e.target.value })}
              className="w-full px-3 py-2 border rounded"
            />
            <div className="flex gap-1 flex-wrap">
              {['uploaded', 'pattern_optimization', 'image_extraction', 'state_discovery'].map(source => (
                <Badge
                  key={source}
                  variant={currentFilter.sources?.includes(source as any) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    const sources = currentFilter.sources || [];
                    const newSources = sources.includes(source as any)
                      ? sources.filter(s => s !== source)
                      : [...sources, source as any];
                    setCurrentFilter({ ...currentFilter, sources: newSources });
                  }}
                >
                  {source}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Example 4: Programmatic Operations
 *
 * Demonstrates programmatic control of the image library.
 */
export function ProgrammaticExample() {
  const { images, updateImage, addImage } = useAutomation();

  const {
    folders,
    createFolder,
    collections,
    createCollection,
    addImagesToCollection,
    addTagToImages,
    selectedImageIds,
    selectAllImages,
    clearSelection,
  } = useImageOrganization({
    images: images.map(img => ({ ...img, folderId: (img as any).folderId, tags: (img as any).tags || [] })),
    onUpdateImage: updateImage as any,
  });

  const handleOrganizeImages = () => {
    // Create folder structure
    const uiFolder = createFolder('UI Components', null, '#3b82f6');
    const buttonsFolder = createFolder('Buttons', uiFolder.id, '#10b981');
    const iconsFolder = createFolder('Icons', uiFolder.id, '#f59e0b');

    // Create collections
    const loginCollection = createCollection(
      'Login Screen',
      'All assets for login screen'
    );

    // Auto-organize by name patterns
    images.forEach(image => {
      if (image.name.toLowerCase().includes('button')) {
        updateImage({ ...image, folderId: buttonsFolder.id } as any);
      } else if (image.name.toLowerCase().includes('icon')) {
        updateImage({ ...image, folderId: iconsFolder.id } as any);
      }
    });

    // Auto-tag
    const buttonImages = images.filter(img => img.name.toLowerCase().includes('button'));
    addTagToImages(buttonImages.map(img => img.id), 'interactive');

    // Add to collection
    const loginImages = images.filter(img => img.name.toLowerCase().includes('login'));
    addImagesToCollection(loginCollection.id, loginImages.map(img => img.id));
  };

  const handleSelectAllUnused = () => {
    const unusedImages = images.filter(img => img.usageCount === 0);
    selectAllImages(unusedImages.map(img => img.id));
  };

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold">Programmatic Operations</h2>

      <div className="space-y-2">
        <Button onClick={handleOrganizeImages} className="w-full">
          Auto-Organize Images
        </Button>
        <Button onClick={handleSelectAllUnused} variant="outline" className="w-full">
          Select All Unused Images
        </Button>
        <Button onClick={clearSelection} variant="outline" className="w-full">
          Clear Selection
        </Button>
      </div>

      <div className="mt-4">
        <EnhancedImageLibrary />
      </div>
    </div>
  );
}

/**
 * Example 5: Integration with Workflow Builder
 *
 * Shows how to integrate with workflow builder for image selection.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function WorkflowIntegrationExample() {
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selectedImageForWorkflow, setSelectedImageForWorkflow] = useState<string | null>(null);

  const handleSelectImageForAction = () => {
    setShowImagePicker(true);
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Workflow Action Editor</h2>

      <div className="border rounded-lg p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Selected Image</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={selectedImageForWorkflow || 'No image selected'}
              readOnly
              className="flex-1 px-3 py-2 border rounded bg-gray-50"
            />
            <Button onClick={handleSelectImageForAction}>
              Choose Image
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showImagePicker} onOpenChange={setShowImagePicker}>
        <DialogContent className="max-w-6xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>Select Image for Action</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <EnhancedImageLibrary />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Example 6: Image Library Dashboard
 *
 * Complete dashboard with stats and organization.
 */
export function DashboardExample() {
  const { images } = useAutomation();

  const stats = {
    total: images.length,
    uploaded: images.filter(img => img.source === 'uploaded').length,
    used: images.filter(img => img.usageCount > 0).length,
    unused: images.filter(img => img.usageCount === 0).length,
    totalSize: images.reduce((acc, img) => acc + img.size, 0),
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Stats Header */}
      <div className="p-6 border-b bg-gradient-to-r from-blue-500/10 to-purple-500/10">
        <h1 className="text-3xl font-bold mb-4">Image Library Dashboard</h1>

        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
            <div className="text-sm text-gray-500 mb-1">Total Images</div>
            <div className="text-3xl font-bold text-blue-500">{stats.total}</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
            <div className="text-sm text-gray-500 mb-1">Uploaded</div>
            <div className="text-3xl font-bold text-green-500">{stats.uploaded}</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
            <div className="text-sm text-gray-500 mb-1">In Use</div>
            <div className="text-3xl font-bold text-purple-500">{stats.used}</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
            <div className="text-sm text-gray-500 mb-1">Unused</div>
            <div className="text-3xl font-bold text-amber-500">{stats.unused}</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
            <div className="text-sm text-gray-500 mb-1">Total Size</div>
            <div className="text-2xl font-bold text-cyan-500">{formatBytes(stats.totalSize)}</div>
          </div>
        </div>
      </div>

      {/* Image Library */}
      <div className="flex-1 overflow-hidden">
        <EnhancedImageLibrary />
      </div>
    </div>
  );
}
