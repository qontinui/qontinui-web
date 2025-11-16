/**
 * Region Analysis Results Component
 *
 * Displays region analysis results with visual overlay of detected regions and grid cells
 */

'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Eye, EyeOff, Download, Layers, Grid3x3, Info } from 'lucide-react'
import { toast } from 'sonner'
import type {
  RegionAnalysisResponse,
  FusedRegion,
  DetectedRegion,
  RegionAnalyzerResult,
} from '@/services/regionAnalysis'

interface RegionAnalysisResultsProps {
  results: RegionAnalysisResponse
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
}

export function RegionAnalysisResults({
  results,
  imageUrl,
  imageWidth = 800,
  imageHeight = 600,
}: RegionAnalysisResultsProps) {
  const [selectedView, setSelectedView] = useState<'fused' | 'individual'>('fused')
  const [selectedAnalyzer, setSelectedAnalyzer] = useState<string | null>(null)
  const [visibleSources, setVisibleSources] = useState<Set<string>>(new Set())
  const [selectedRegion, setSelectedRegion] = useState<FusedRegion | DetectedRegion | null>(
    null
  )
  const [showGridCells, setShowGridCells] = useState(true)
  const [showCellNumbers, setShowCellNumbers] = useState(true)
  const [zoom, setZoom] = useState(1)

  // Toggle source visibility
  const toggleSource = (source: string) => {
    const newVisible = new Set(visibleSources)
    if (newVisible.has(source)) {
      newVisible.delete(source)
    } else {
      newVisible.add(source)
    }
    setVisibleSources(newVisible)
  }

  // Export results as JSON
  const handleExport = () => {
    const dataStr = JSON.stringify(results, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `region_analysis_results_${results.annotation_set_id}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Results exported')
  }

  const getColorForSource = (source: string, index: number): string => {
    const colors = [
      '#ef4444', // red
      '#3b82f6', // blue
      '#10b981', // green
      '#f59e0b', // yellow
      '#8b5cf6', // purple
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#f97316', // orange
    ]
    return colors[index % colors.length]
  }

  const regionsToDisplay =
    selectedView === 'fused'
      ? results.fused_regions || []
      : selectedAnalyzer
      ? results.analyzer_results
          .find((r) => r.analyzer_name === selectedAnalyzer)
          ?.regions || []
      : []

  // Calculate total grid cells
  const totalGridCells = regionsToDisplay.reduce((sum, region) => {
    return sum + (region.grid_metadata?.cells.length || 0)
  }, 0)

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Region Analysis Summary</CardTitle>
          <CardDescription>
            Results from {results.analyzer_results.length} analyzer(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-2xl font-bold">
                {results.fused_regions?.length || 0}
              </div>
              <div className="text-xs text-muted-foreground">Fused Regions</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.analyzer_results.reduce(
                  (sum, r) => sum + r.regions.length,
                  0
                )}
              </div>
              <div className="text-xs text-muted-foreground">Total Detections</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.fusion_stats?.total_grid_cells || 0}
              </div>
              <div className="text-xs text-muted-foreground">Grid Cells</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.fusion_stats?.avg_confidence.toFixed(2) || 'N/A'}
              </div>
              <div className="text-xs text-muted-foreground">Avg Confidence</div>
            </div>
            <div>
              <div className="text-2xl font-bold">
                {results.fusion_stats?.multi_vote_regions || 0}
              </div>
              <div className="text-xs text-muted-foreground">Multi-Vote</div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button onClick={handleExport} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Visualization and Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Visualization */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Visual Results</CardTitle>
                <CardDescription>
                  {regionsToDisplay.length} region(s), {totalGridCells} cell(s)
                </CardDescription>
              </div>

              <div className="flex gap-2">
                <Select
                  value={selectedView}
                  onValueChange={(v: 'fused' | 'individual') => setSelectedView(v)}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fused">Fused Results</SelectItem>
                    <SelectItem value="individual">Individual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Grid Visualization Controls */}
            <div className="flex gap-4 pt-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={showGridCells ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowGridCells(!showGridCells)}
                >
                  <Grid3x3 className="h-4 w-4 mr-2" />
                  Grid Cells
                </Button>
                <Button
                  variant={showCellNumbers ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowCellNumbers(!showCellNumbers)}
                  disabled={!showGridCells}
                >
                  Cell Numbers
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom(Math.min(zoom + 0.25, 3))}
                >
                  Zoom +
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom(Math.max(zoom - 0.25, 0.5))}
                >
                  Zoom -
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setZoom(1)}
                >
                  Reset
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {selectedView === 'individual' && (
              <div className="mb-4">
                <Select
                  value={selectedAnalyzer || ''}
                  onValueChange={setSelectedAnalyzer}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select analyzer" />
                  </SelectTrigger>
                  <SelectContent>
                    {results.analyzer_results.map((result) => (
                      <SelectItem key={result.analyzer_name} value={result.analyzer_name}>
                        {result.analyzer_name} ({result.regions.length} regions)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="relative border rounded-lg overflow-auto bg-muted">
              {imageUrl ? (
                <div className="relative inline-block" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                  <img
                    src={imageUrl}
                    alt="Region analysis visualization"
                    className="block"
                    style={{ width: imageWidth, height: imageHeight }}
                  />

                  {/* Overlay detected regions and grids */}
                  <svg
                    className="absolute top-0 left-0 pointer-events-none"
                    width={imageWidth}
                    height={imageHeight}
                    viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {selectedView === 'fused' &&
                      (results.fused_regions || []).map((region, regionIndex) => {
                        const color = getColorForSource(
                          region.sources[0],
                          regionIndex
                        )
                        const hasGrid = region.grid_metadata && region.grid_metadata.cells.length > 0

                        return (
                          <g key={regionIndex}>
                            {/* Region bounding box */}
                            <rect
                              x={region.bounding_box.x}
                              y={region.bounding_box.y}
                              width={region.bounding_box.width}
                              height={region.bounding_box.height}
                              fill="none"
                              stroke={color}
                              strokeWidth="4"
                              opacity="0.9"
                            />

                            {/* Region label */}
                            <text
                              x={region.bounding_box.x + 5}
                              y={region.bounding_box.y + 25}
                              fill={color}
                              fontSize="16"
                              fontWeight="bold"
                              style={{
                                textShadow: '0 0 4px black, 0 0 4px black',
                              }}
                            >
                              {region.label || region.region_type || `R${regionIndex + 1}`}
                              {hasGrid && ` (${region.grid_metadata!.rows}×${region.grid_metadata!.cols})`}
                            </text>

                            {/* Grid cells if available */}
                            {showGridCells && hasGrid && region.grid_metadata!.cells.map((cell, cellIndex) => (
                              <g key={cellIndex}>
                                <rect
                                  x={cell.bounding_box.x}
                                  y={cell.bounding_box.y}
                                  width={cell.bounding_box.width}
                                  height={cell.bounding_box.height}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth="2"
                                  strokeDasharray="4,4"
                                  opacity="0.6"
                                />

                                {/* Cell numbers */}
                                {showCellNumbers && (
                                  <text
                                    x={cell.bounding_box.x + cell.bounding_box.width / 2}
                                    y={cell.bounding_box.y + cell.bounding_box.height / 2 + 5}
                                    fill={color}
                                    fontSize="12"
                                    fontWeight="bold"
                                    textAnchor="middle"
                                    style={{
                                      textShadow: '0 0 3px black, 0 0 3px black',
                                    }}
                                  >
                                    [{cell.row},{cell.col}]
                                  </text>
                                )}
                              </g>
                            ))}
                          </g>
                        )
                      })}

                    {selectedView === 'individual' &&
                      selectedAnalyzer &&
                      (
                        results.analyzer_results.find(
                          (r) => r.analyzer_name === selectedAnalyzer
                        )?.regions || []
                      ).map((region, regionIndex) => {
                        const color = '#3b82f6'
                        const hasGrid = region.grid_metadata && region.grid_metadata.cells.length > 0

                        return (
                          <g key={regionIndex}>
                            {/* Region bounding box */}
                            <rect
                              x={region.bounding_box.x}
                              y={region.bounding_box.y}
                              width={region.bounding_box.width}
                              height={region.bounding_box.height}
                              fill="none"
                              stroke={color}
                              strokeWidth="3"
                              opacity="0.8"
                            />

                            {/* Region label */}
                            <text
                              x={region.bounding_box.x + 5}
                              y={region.bounding_box.y + 20}
                              fill={color}
                              fontSize="14"
                              fontWeight="bold"
                              style={{
                                textShadow: '0 0 3px black, 0 0 3px black',
                              }}
                            >
                              {region.label || region.region_type || `R${regionIndex + 1}`}
                              {hasGrid && ` (${region.grid_metadata!.rows}×${region.grid_metadata!.cols})`}
                            </text>

                            {/* Grid cells if available */}
                            {showGridCells && hasGrid && region.grid_metadata!.cells.map((cell, cellIndex) => (
                              <g key={cellIndex}>
                                <rect
                                  x={cell.bounding_box.x}
                                  y={cell.bounding_box.y}
                                  width={cell.bounding_box.width}
                                  height={cell.bounding_box.height}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth="1.5"
                                  strokeDasharray="3,3"
                                  opacity="0.5"
                                />

                                {/* Cell numbers */}
                                {showCellNumbers && (
                                  <text
                                    x={cell.bounding_box.x + cell.bounding_box.width / 2}
                                    y={cell.bounding_box.y + cell.bounding_box.height / 2 + 4}
                                    fill={color}
                                    fontSize="10"
                                    fontWeight="bold"
                                    textAnchor="middle"
                                    style={{
                                      textShadow: '0 0 2px black, 0 0 2px black',
                                    }}
                                  >
                                    [{cell.row},{cell.col}]
                                  </text>
                                )}
                              </g>
                            ))}
                          </g>
                        )
                      })}
                  </svg>
                </div>
              ) : (
                <div className="flex items-center justify-center h-96">
                  <div className="text-center text-muted-foreground">
                    <Layers className="mx-auto h-12 w-12 mb-2" />
                    <p>No image to display</p>
                  </div>
                </div>
              )}
            </div>

            {selectedView === 'fused' && (results.fused_regions?.length || 0) > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="h-4 w-4" />
                  <span className="text-sm font-medium">Sources</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from(
                    new Set(
                      results.fused_regions?.flatMap((r) => r.sources) || []
                    )
                  ).map((source, index) => (
                    <Badge
                      key={source}
                      variant={visibleSources.has(source) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleSource(source)}
                      style={{
                        borderColor: getColorForSource(source, index),
                        backgroundColor: visibleSources.has(source)
                          ? getColorForSource(source, index)
                          : 'transparent',
                      }}
                    >
                      {visibleSources.has(source) ? (
                        <Eye className="mr-1 h-3 w-3" />
                      ) : (
                        <EyeOff className="mr-1 h-3 w-3" />
                      )}
                      {source}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Region Details */}
        <Card>
          <CardHeader>
            <CardTitle>Region Details</CardTitle>
            <CardDescription>
              Click a region to view details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="list" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="stats">Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-2">
                <ScrollArea className="h-96">
                  {regionsToDisplay.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No regions detected
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {regionsToDisplay.map((region, index) => {
                        const isFused = 'votes' in region
                        const hasGrid = region.grid_metadata && region.grid_metadata.cells.length > 0
                        return (
                          <button
                            key={index}
                            onClick={() => setSelectedRegion(region)}
                            className={`w-full text-left p-3 rounded border transition-colors ${
                              selectedRegion === region
                                ? 'border-primary bg-accent'
                                : 'border-border hover:bg-accent'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-1">
                              <div className="font-medium flex items-center gap-2">
                                {region.label || region.region_type || `Region ${index + 1}`}
                                {hasGrid && (
                                  <Badge variant="secondary" className="text-xs">
                                    <Grid3x3 className="h-3 w-3 mr-1" />
                                    {region.grid_metadata!.rows}×{region.grid_metadata!.cols}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                {isFused && (
                                  <Badge variant="secondary" className="text-xs">
                                    {(region as FusedRegion).votes} votes
                                  </Badge>
                                )}
                                <Badge
                                  variant={
                                    region.confidence > 0.7
                                      ? 'default'
                                      : region.confidence > 0.4
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                  className="text-xs"
                                >
                                  {(region.confidence * 100).toFixed(0)}%
                                </Badge>
                              </div>
                            </div>

                            <div className="text-xs text-muted-foreground">
                              {Math.round(region.bounding_box.width)} ×{' '}
                              {Math.round(region.bounding_box.height)}px
                              {hasGrid && ` • ${region.grid_metadata!.cells.length} cells`}
                            </div>

                            {isFused && (region as FusedRegion).sources.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(region as FusedRegion).sources.map((source) => (
                                  <Badge
                                    key={source}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {source}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="stats" className="space-y-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Per-Analyzer Results</div>
                  {results.analyzer_results.map((result) => (
                    <div
                      key={result.analyzer_name}
                      className="flex items-center justify-between p-2 border rounded"
                    >
                      <div className="text-sm">{result.analyzer_name}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{result.regions.length}</Badge>
                        <Badge variant="outline">
                          {(result.confidence * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium">Grid Statistics</div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Total Grids</span>
                      <Badge variant="outline">
                        {regionsToDisplay.filter(r => r.grid_metadata).length}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Total Cells</span>
                      <Badge variant="outline">{totalGridCells}</Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium">Confidence Distribution</div>
                  {['High (>70%)', 'Medium (40-70%)', 'Low (<40%)'].map((range, i) => {
                    const count = regionsToDisplay.filter((r) => {
                      if (i === 0) return r.confidence > 0.7
                      if (i === 1) return r.confidence >= 0.4 && r.confidence <= 0.7
                      return r.confidence < 0.4
                    }).length
                    return (
                      <div key={range} className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{range}</span>
                        <Badge variant="outline">{count}</Badge>
                      </div>
                    )
                  })}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      {/* Selected Region Details */}
      {selectedRegion && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Selected Region Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium">Label</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedRegion.label || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Type</div>
                  <div className="text-sm text-muted-foreground">
                    {selectedRegion.region_type || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Confidence</div>
                  <div className="text-sm text-muted-foreground">
                    {(selectedRegion.confidence * 100).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Position</div>
                  <div className="text-sm text-muted-foreground">
                    ({Math.round(selectedRegion.bounding_box.x)},{' '}
                    {Math.round(selectedRegion.bounding_box.y)})
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Size</div>
                  <div className="text-sm text-muted-foreground">
                    {Math.round(selectedRegion.bounding_box.width)} ×{' '}
                    {Math.round(selectedRegion.bounding_box.height)}px
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium">Area</div>
                  <div className="text-sm text-muted-foreground">
                    {Math.round(
                      selectedRegion.bounding_box.width *
                        selectedRegion.bounding_box.height
                    )}{' '}
                    px²
                  </div>
                </div>
              </div>

              {/* Grid metadata if available */}
              {selectedRegion.grid_metadata && (
                <>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Grid3x3 className="h-4 w-4" />
                      Grid Information
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm font-medium">Grid Size</div>
                        <div className="text-sm text-muted-foreground">
                          {selectedRegion.grid_metadata.rows} rows × {selectedRegion.grid_metadata.cols} columns
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium">Total Cells</div>
                        <div className="text-sm text-muted-foreground">
                          {selectedRegion.grid_metadata.cells.length}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium">Cell Size</div>
                        <div className="text-sm text-muted-foreground">
                          {Math.round(selectedRegion.grid_metadata.cell_width)} ×{' '}
                          {Math.round(selectedRegion.grid_metadata.cell_height)}px
                        </div>
                      </div>
                      {selectedRegion.grid_metadata.horizontal_spacing !== undefined && (
                        <div>
                          <div className="text-sm font-medium">Spacing</div>
                          <div className="text-sm text-muted-foreground">
                            H: {Math.round(selectedRegion.grid_metadata.horizontal_spacing)}px,{' '}
                            V: {Math.round(selectedRegion.grid_metadata.vertical_spacing || 0)}px
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {'votes' in selectedRegion && (
                <>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium mb-2">Source Confidences</div>
                    <div className="space-y-1">
                      {Object.entries(
                        (selectedRegion as FusedRegion).source_confidences
                      ).map(([source, conf]) => (
                        <div key={source} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{source}</span>
                          <Badge variant="outline">
                            {(conf * 100).toFixed(0)}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedRegion.metadata &&
                Object.keys(selectedRegion.metadata).length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="text-sm font-medium mb-2">Metadata</div>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(selectedRegion.metadata, null, 2)}
                      </pre>
                    </div>
                  </>
                )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
