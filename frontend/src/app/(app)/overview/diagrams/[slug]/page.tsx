import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MermaidDiagram } from "@/components/overview/MermaidDiagram";
import { scenarioA } from "../../mock-data";

export default async function DiagramDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const diagram = scenarioA.diagrams.find((item) => item.id === slug);
  if (!diagram) notFound();
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.diagrams.detail">
    <Card><CardHeader><CardTitle>{diagram.title}</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
      {diagram.description && <p className="text-sm text-muted-foreground">{diagram.description}</p>}
      <MermaidDiagram source={diagram.source} />
    </CardContent></Card>
  </div>;
}
