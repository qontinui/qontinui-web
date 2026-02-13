"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Map,
  MapPin,
  Type,
  Image as ImageIcon,
  Target,
  Accessibility,
} from "lucide-react";
import { StateHeader } from "./StateHeader";
import { StateImageTab } from "./StateImageTab";
import { RegionsTab } from "./RegionsTab";
import { LocationsTab } from "./LocationsTab";
import { StringsTab } from "./StringsTab";
import { TransitionsTab } from "./TransitionsTab";
import { AccessibilityTab } from "./AccessibilityTab";
import type { StatePropertiesPanelProps } from "./types";

export function StatePropertiesPanel({
  state,
  allStates,
  images,
  incomingTransitions,
  workflows,
  updateState,
  addTransition,
  updateTransition,
  deleteTransition: _deleteTransition,
  addWorkflow,
  addStateImage,
  updateStateImage,
  removeStateImage,
  moveStateImage,
  addRegion: _addRegion,
  updateRegion,
  removeRegion,
  addLocation: _addLocation,
  updateLocation,
  removeLocation,
  addString,
  updateString,
  removeString,
}: StatePropertiesPanelProps) {
  return (
    <Card className="border-0 bg-transparent h-full flex flex-col">
      <StateHeader state={state} updateState={updateState} />
      <CardContent className="flex-1 flex flex-col gap-2 overflow-hidden px-0 pt-1 pb-6">
        <Tabs
          defaultValue="images"
          className="flex-1 flex flex-col min-h-0 rounded-lg bg-surface-raised overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-6 h-10 bg-surface-raised/80 p-1 rounded-none">
            <TabsTrigger
              value="images"
              className="text-xs flex items-center justify-center data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary data-[state=active]:border data-[state=active]:border-brand-primary/50 data-[state=inactive]:text-text-muted transition-all"
            >
              <ImageIcon className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="regions"
              className="text-xs flex items-center justify-center data-[state=active]:bg-brand-secondary/20 data-[state=active]:text-brand-secondary data-[state=active]:border data-[state=active]:border-brand-secondary/50 data-[state=inactive]:text-text-muted transition-all"
            >
              <Map className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="locations"
              className="text-xs flex items-center justify-center data-[state=active]:bg-brand-success/20 data-[state=active]:text-brand-success data-[state=active]:border data-[state=active]:border-brand-success/50 data-[state=inactive]:text-text-muted transition-all"
            >
              <MapPin className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="strings"
              className="text-xs flex items-center justify-center data-[state=active]:bg-[#FFD700]/20 data-[state=active]:text-[#FFD700] data-[state=active]:border data-[state=active]:border-[#FFD700]/50 data-[state=inactive]:text-text-muted transition-all"
            >
              <Type className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="accessibility"
              className="text-xs flex items-center justify-center data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-500 data-[state=active]:border data-[state=active]:border-purple-500/50 data-[state=inactive]:text-text-muted transition-all"
            >
              <Accessibility className="w-4 h-4" />
            </TabsTrigger>
            <TabsTrigger
              value="transitions"
              className="text-xs flex items-center justify-center data-[state=active]:bg-brand-success/20 data-[state=active]:text-brand-success data-[state=active]:border data-[state=active]:border-brand-success/50 data-[state=inactive]:text-text-muted transition-all"
            >
              <Target className="w-4 h-4" />
            </TabsTrigger>
          </TabsList>

          {/* Images Tab */}
          <StateImageTab
            state={state}
            allStates={allStates}
            images={images}
            addStateImage={addStateImage}
            updateStateImage={updateStateImage}
            removeStateImage={removeStateImage}
            moveStateImage={moveStateImage}
          />

          {/* Regions Tab */}
          <RegionsTab
            state={state}
            allStates={allStates}
            updateRegion={updateRegion}
            removeRegion={removeRegion}
          />

          {/* Locations Tab */}
          <LocationsTab
            state={state}
            allStates={allStates}
            updateLocation={updateLocation}
            removeLocation={removeLocation}
          />

          {/* Strings Tab */}
          <StringsTab
            state={state}
            addString={addString}
            updateString={updateString}
            removeString={removeString}
          />

          {/* Accessibility Tab */}
          <AccessibilityTab state={state} />

          {/* Transitions Tab */}
          <TransitionsTab
            state={state}
            incomingTransitions={incomingTransitions}
            workflows={workflows}
            addTransition={addTransition}
            updateTransition={updateTransition}
            addWorkflow={addWorkflow}
          />
        </Tabs>
      </CardContent>
    </Card>
  );
}
