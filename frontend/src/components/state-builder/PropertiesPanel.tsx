"use client";

import React from "react";
import { Plus, Trash2, ImageIcon, Settings } from "lucide-react";
import type { State, Pattern } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface PropertiesPanelProps {
  currentState: State | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  handleUpdateCurrentState: (updates: Partial<State>) => void;
  handleAddStateImage: () => void;
  handleRemoveStateImage: (index: number) => void;
  handleAddRegion: () => void;
  handleAddLocation: () => void;
  stateComplexity: (state: State) => number;
  resolvePatternImage: (
    pattern: Pattern
  ) => { url: string; mask?: string } | null;
}

export function PropertiesPanel({
  currentState,
  activeTab,
  setActiveTab,
  handleUpdateCurrentState,
  handleAddStateImage,
  handleRemoveStateImage,
  handleAddRegion,
  handleAddLocation,
  stateComplexity,
  resolvePatternImage,
}: PropertiesPanelProps) {
  if (!currentState) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent className="text-center text-muted-foreground">
          <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a state to view properties</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Properties</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="h-full flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" className="text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="images" className="text-xs">
              Images
            </TabsTrigger>
            <TabsTrigger value="regions" className="text-xs">
              Regions
            </TabsTrigger>
            <TabsTrigger value="locations" className="text-xs">
              Locations
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="overview" className="space-y-4 m-0">
              <div className="space-y-2">
                <Label className="text-xs">Name</Label>
                <Input
                  value={currentState.name}
                  onChange={(e) =>
                    handleUpdateCurrentState({ name: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={currentState.description || ""}
                  onChange={(e) =>
                    handleUpdateCurrentState({ description: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="initial"
                  checked={currentState.initial || false}
                  onCheckedChange={(checked) =>
                    handleUpdateCurrentState({ initial: checked as boolean })
                  }
                />
                <Label htmlFor="initial" className="text-xs">
                  Initial State
                </Label>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Complexity Score</Label>
                <Badge
                  variant="outline"
                  className={cn(
                    "w-full justify-center",
                    stateComplexity(currentState) < 5 &&
                      "border-green-500 text-green-500",
                    stateComplexity(currentState) >= 5 &&
                      stateComplexity(currentState) < 15 &&
                      "border-yellow-500 text-yellow-500",
                    stateComplexity(currentState) >= 15 &&
                      "border-red-500 text-red-500"
                  )}
                >
                  {stateComplexity(currentState)}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    StateImages
                  </Label>
                  <div className="text-lg font-semibold">
                    {currentState.stateImages?.length || 0}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Regions
                  </Label>
                  <div className="text-lg font-semibold">
                    {currentState.regions?.length || 0}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Locations
                  </Label>
                  <div className="text-lg font-semibold">
                    {currentState.locations?.length || 0}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Strings
                  </Label>
                  <div className="text-lg font-semibold">
                    {currentState.strings?.length || 0}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="images" className="space-y-4 m-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs">StateImages</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddStateImage}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>

              <div className="space-y-3">
                {currentState.stateImages?.map((stateImage, idx) => (
                  <Card key={stateImage.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-medium">
                          {stateImage.name}
                        </CardTitle>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveStateImage(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="text-xs text-muted-foreground">
                        {stateImage.patterns?.length || 0} pattern(s)
                      </div>
                      {stateImage.patterns?.[0] && (
                        <div className="aspect-video rounded overflow-hidden bg-muted">
                          {(() => {
                            const imageData = resolvePatternImage(
                              stateImage.patterns[0]
                            );
                            return imageData ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={imageData.url}
                                alt={stateImage.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon className="h-8 w-8 text-muted-foreground" />
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="regions" className="space-y-4 m-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Regions</Label>
                <Button size="sm" variant="outline" onClick={handleAddRegion}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>

              <div className="space-y-2">
                {currentState.regions?.map((region) => (
                  <Card key={region.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="font-medium text-sm">{region.name}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>X: {region.x}</div>
                        <div>Y: {region.y}</div>
                        <div>W: {region.width}</div>
                        <div>H: {region.height}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="locations" className="space-y-4 m-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Locations</Label>
                <Button size="sm" variant="outline" onClick={handleAddLocation}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>

              <div className="space-y-2">
                {currentState.locations?.map((location) => (
                  <Card key={location.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="font-medium text-sm">{location.name}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>X: {location.x}</div>
                        <div>Y: {location.y}</div>
                        {location.anchor && (
                          <div className="col-span-2">
                            <Badge variant="secondary" className="text-xs">
                              Anchor
                            </Badge>
                          </div>
                        )}
                        {location.fixed && (
                          <div className="col-span-2">
                            <Badge variant="secondary" className="text-xs">
                              Fixed
                            </Badge>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}
