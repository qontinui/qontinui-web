import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { scenarioA } from "../../mock-data";

export default async function WikiTopicDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const topic = scenarioA.wikiTopics.find((item) => item.slug === slug);
  if (!topic) notFound();
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.wiki.detail">
    <Card><CardHeader><CardTitle>{topic.title}</CardTitle></CardHeader><CardContent><MarkdownView content={topic.content} /></CardContent></Card>
  </div>;
}
