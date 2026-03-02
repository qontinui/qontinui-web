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
  return (
    <div className={cn("space-y-6", className)}>
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runner">Runner Detail</TabsTrigger>
          <TabsTrigger value="data-flow">Data Flow</TabsTrigger>
          <TabsTrigger value="ports">Ports & Services</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="runner" className="mt-6">
          <RunnerDetailTab />
        </TabsContent>

        <TabsContent value="data-flow" className="mt-6">
          <DataFlowTab />
        </TabsContent>

        <TabsContent value="ports" className="mt-6">
          <PortsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ArchitectureDiagrams;
