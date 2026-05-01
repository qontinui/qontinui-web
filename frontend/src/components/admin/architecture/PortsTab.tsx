import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Monitor,
  Database,
  Globe,
  HardDrive,
  Terminal,
} from "lucide-react";

interface ServiceEntry {
  icon: React.ReactNode;
  label: string;
  port: string;
  highlighted?: boolean;
}

const APP_SERVICES: ServiceEntry[] = [
  {
    icon: <Globe className="w-4 h-4" />,
    label: "Frontend",
    port: "localhost:3001",
  },
  {
    icon: <Server className="w-4 h-4" />,
    label: "Main Backend",
    port: "localhost:8000",
  },
  {
    icon: <Terminal className="w-4 h-4 text-primary" />,
    label: "Runner",
    port: "localhost:9876",
    highlighted: true,
  },
  {
    icon: <Monitor className="w-4 h-4" />,
    label: "Runner Vite",
    port: "localhost:1420",
  },
];

const INFRA_SERVICES: ServiceEntry[] = [
  {
    icon: <Database className="w-4 h-4" />,
    label: "PostgreSQL",
    port: "localhost:5433",
  },
  {
    icon: <Database className="w-4 h-4" />,
    label: "Redis",
    port: "localhost:6379",
  },
  {
    icon: <HardDrive className="w-4 h-4" />,
    label: "MinIO API",
    port: "localhost:9000",
  },
  {
    icon: <HardDrive className="w-4 h-4" />,
    label: "MinIO Console",
    port: "localhost:9001",
  },
];

const ServiceRow: React.FC<{ entry: ServiceEntry }> = ({ entry }) => {
  const rowClass = entry.highlighted
    ? "flex items-center justify-between p-3 bg-primary/10 rounded border border-primary/30"
    : "flex items-center justify-between p-3 bg-muted/50 rounded";

  const labelClass = entry.highlighted
    ? "font-mono text-sm font-semibold"
    : "font-mono text-sm";

  return (
    <div className={rowClass}>
      <div className="flex items-center gap-2">
        {entry.icon}
        <span className={labelClass} data-content-role="label">
          {entry.label}
        </span>
      </div>
      <Badge variant={entry.highlighted ? undefined : "outline"}>
        {entry.port}
      </Badge>
    </div>
  );
};

const ServiceColumn: React.FC<{
  title: string;
  entries: ServiceEntry[];
}> = ({ title, entries }) => {
  return (
    <div>
      <h4 className="font-semibold mb-4">{title}</h4>
      <div className="space-y-3">
        {entries.map((entry) => (
          <ServiceRow key={entry.label} entry={entry} />
        ))}
      </div>
    </div>
  );
};

export const PortsTab: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          Ports & Services Reference
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          All services and their default ports in local development.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          <ServiceColumn title="Application Services" entries={APP_SERVICES} />
          <ServiceColumn
            title="Infrastructure Services"
            entries={INFRA_SERVICES}
          />
        </div>

        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-sm text-yellow-600 dark:text-yellow-500">
            <strong>Note:</strong> qontinui-api (port 8001) has been deprecated.
            All computer vision and extraction functionality now goes through
            the runner (port 9876).
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
