import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { OverviewTab } from "./OverviewTab";
import { RunnerDetailTab } from "./RunnerDetailTab";
import { DataFlowTab } from "./DataFlowTab";
import { PortsTab } from "./PortsTab";

interface ArchitectureDiagramsProps {
  className?: string;
}

export const ArchitectureDiagrams: React.FC<ArchitectureDiagramsProps> = ({
  className,
}) => {
  // NOTE on layout: the shared `Tabs` primitive forces `flex flex-col` on the
  // Radix root and `min-h-0` on every `TabsContent`. Here `ArchitectureDiagrams`
  // is rendered inside a height-constrained, `overflow-hidden` page wrapper with
  // no explicit height handed down to the tabs. In that context the column-flex
  // root + `min-h-0` panel collapses the active tab panel to height 0, so the
  // diagram Cards are present in the DOM but clipped to invisibility (the page
  // looked blank below the tab bar even for admins). We override the root back
  // to normal block flow (`!flex-none`/`block`) and give each panel an explicit
  // `h-auto` so it sizes to its content and is scrolled by the page wrapper.
  return (
    <div className={cn("space-y-6", className)}>
      <Tabs defaultValue="overview" className="block w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runner">Runner Detail</TabsTrigger>
          <TabsTrigger value="data-flow">Data Flow</TabsTrigger>
          <TabsTrigger value="ports">Ports & Services</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 h-auto">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="runner" className="mt-6 h-auto">
          <RunnerDetailTab />
        </TabsContent>

        <TabsContent value="data-flow" className="mt-6 h-auto">
          <DataFlowTab />
        </TabsContent>

        <TabsContent value="ports" className="mt-6 h-auto">
          <PortsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ArchitectureDiagrams;
