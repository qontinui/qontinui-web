/**
 * PythonFileBrowser Example
 *
 * Standalone example demonstrating the PythonFileBrowser component
 * with mock data for testing and development.
 */

"use client";

import React, { useState } from "react";
import { PythonFileBrowser, PythonFile } from "./PythonFileBrowser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Mock data for demonstration
const MOCK_FILES: PythonFile[] = [
  {
    path: "scripts/detector.py",
    name: "detector.py",
    size: 2048,
    lastModified: "2025-11-22T10:30:00Z",
    isValid: true,
  },
  {
    path: "scripts/utils.py",
    name: "utils.py",
    size: 1024,
    lastModified: "2025-11-22T09:15:00Z",
    isValid: true,
  },
  {
    path: "scripts/helpers/image_processing.py",
    name: "image_processing.py",
    size: 3072,
    lastModified: "2025-11-21T16:45:00Z",
    isValid: true,
  },
  {
    path: "scripts/helpers/math_utils.py",
    name: "math_utils.py",
    size: 512,
    lastModified: "2025-11-20T14:20:00Z",
    isValid: true,
  },
  {
    path: "automation/civ6_utils.py",
    name: "civ6_utils.py",
    size: 4096,
    lastModified: "2025-11-22T11:00:00Z",
    isValid: true,
  },
  {
    path: "automation/unit_detector.py",
    name: "unit_detector.py",
    size: 2560,
    lastModified: "2025-11-19T08:30:00Z",
    isValid: true,
  },
  {
    path: "lib/vision_helpers.py",
    name: "vision_helpers.py",
    size: 1536,
    lastModified: "2025-11-18T12:00:00Z",
    isValid: true,
  },
  {
    path: "lib/config_loader.py",
    name: "config_loader.py",
    size: 768,
    lastModified: "2025-11-17T15:30:00Z",
    isValid: true,
  },
  {
    path: "tests/test_detector.py",
    name: "test_detector.py",
    size: 2048,
    lastModified: "2025-11-22T10:30:00Z",
    isValid: true,
  },
  {
    path: "main.py",
    name: "main.py",
    size: 512,
    lastModified: "2025-11-15T10:00:00Z",
    isValid: true,
  },
];

export function PythonFileBrowserExample() {
  const [selectedPath, setSelectedPath] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<PythonFile[]>(MOCK_FILES);

  const handleRefresh = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      // Simulate new file added
      if (files.length === MOCK_FILES.length) {
        setFiles([
          ...MOCK_FILES,
          {
            path: "new_file.py",
            name: "new_file.py",
            size: 256,
            lastModified: new Date().toISOString(),
            isValid: true,
          },
        ]);
      } else {
        setFiles(MOCK_FILES);
      }
    }, 1000);
  };

  const simulateError = () => {
    setError("Failed to load files from server");
    setFiles([]);
  };

  const clearError = () => {
    setError(null);
    setFiles(MOCK_FILES);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Python File Browser Example
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Standalone demonstration of the PythonFileBrowser component with
            mock data
          </p>
        </div>

        <Tabs defaultValue="normal" className="w-full">
          <TabsList>
            <TabsTrigger value="normal">Normal State</TabsTrigger>
            <TabsTrigger value="loading">Loading State</TabsTrigger>
            <TabsTrigger value="error">Error State</TabsTrigger>
            <TabsTrigger value="empty">Empty State</TabsTrigger>
          </TabsList>

          {/* Normal State */}
          <TabsContent value="normal" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* File Browser */}
              <Card>
                <CardHeader>
                  <CardTitle>File Browser</CardTitle>
                </CardHeader>
                <CardContent>
                  <PythonFileBrowser
                    selectedPath={selectedPath}
                    onSelectFile={setSelectedPath}
                    files={files}
                    isLoading={isLoading}
                    error={error}
                    onRefresh={handleRefresh}
                    height="500px"
                    showMetadata={true}
                  />
                </CardContent>
              </Card>

              {/* Selection Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Selection Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedPath ? (
                    <>
                      <div>
                        <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Selected File
                        </Label>
                        <div className="mt-1 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
                          <code className="text-sm text-blue-900 dark:text-blue-100">
                            {selectedPath}
                          </code>
                        </div>
                      </div>

                      {(() => {
                        const file = files.find((f) => f.path === selectedPath);
                        if (!file) return null;

                        return (
                          <>
                            <div>
                              <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                File Name
                              </Label>
                              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                                {file.name}
                              </p>
                            </div>

                            <div>
                              <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                File Size
                              </Label>
                              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                                {file.size} bytes
                              </p>
                            </div>

                            <div>
                              <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Last Modified
                              </Label>
                              <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                                {new Date(file.lastModified).toLocaleString()}
                              </p>
                            </div>

                            <div>
                              <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Valid
                              </Label>
                              <div className="mt-1">
                                <Badge
                                  variant={
                                    file.isValid ? "default" : "destructive"
                                  }
                                >
                                  {file.isValid ? "Yes" : "No"}
                                </Badge>
                              </div>
                            </div>
                          </>
                        );
                      })()}

                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setSelectedPath(undefined)}
                      >
                        Clear Selection
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <p>No file selected</p>
                      <p className="text-sm mt-2">
                        Select a file from the browser to see details
                      </p>
                    </div>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Actions
                    </Label>
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleRefresh}
                      >
                        Refresh Files
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={simulateError}
                      >
                        Simulate Error
                      </Button>
                      {error && (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={clearError}
                        >
                          Clear Error
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Loading State */}
          <TabsContent value="loading">
            <Card>
              <CardHeader>
                <CardTitle>Loading State</CardTitle>
              </CardHeader>
              <CardContent>
                <PythonFileBrowser
                  selectedPath={selectedPath}
                  onSelectFile={setSelectedPath}
                  files={[]}
                  isLoading={true}
                  error={null}
                  height="500px"
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Error State */}
          <TabsContent value="error">
            <Card>
              <CardHeader>
                <CardTitle>Error State</CardTitle>
              </CardHeader>
              <CardContent>
                <PythonFileBrowser
                  selectedPath={selectedPath}
                  onSelectFile={setSelectedPath}
                  files={[]}
                  isLoading={false}
                  error="Failed to connect to backend API. Please check your network connection."
                  onRefresh={() => alert("Refresh clicked")}
                  height="500px"
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Empty State */}
          <TabsContent value="empty">
            <Card>
              <CardHeader>
                <CardTitle>Empty State</CardTitle>
              </CardHeader>
              <CardContent>
                <PythonFileBrowser
                  selectedPath={selectedPath}
                  onSelectFile={setSelectedPath}
                  files={[]}
                  isLoading={false}
                  error={null}
                  height="500px"
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Component Info */}
        <Card>
          <CardHeader>
            <CardTitle>Component Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Features Demonstrated
              </h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <li>Tree view with expandable directories</li>
                <li>File search and filtering</li>
                <li>File metadata display (size, last modified)</li>
                <li>Loading, error, and empty states</li>
                <li>Refresh functionality</li>
                <li>Keyboard navigation support</li>
                <li>Accessible design with ARIA labels</li>
              </ul>
            </div>

            <Separator />

            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Total Files
              </h3>
              <Badge variant="secondary">{files.length} Python files</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Helper component for labels
function Label({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={className}>{children}</div>;
}

export default PythonFileBrowserExample;
