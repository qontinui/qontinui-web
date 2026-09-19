import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { scenarioA } from "../../mock-data";

export default async function DocumentDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const document = scenarioA.documents.find((item) => item.id === slug);
  if (!document) notFound();
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.documents.detail">
    <Card><CardHeader><CardTitle>{document.title}</CardTitle></CardHeader><CardContent>
      {document.content ? <MarkdownView content={document.content} /> : <p className="text-sm text-muted-foreground">This file has no preview available.</p>}
    </CardContent></Card>
  </div>;
}
