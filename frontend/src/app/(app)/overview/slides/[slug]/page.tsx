import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { scenarioA } from "../../mock-data";

export default async function SlideDeckDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const deck = scenarioA.slides.find((item) => item.id === slug);
  if (!deck) notFound();
  return <div className="flex flex-col gap-6 p-6" data-ui-bridge-id="overview.slides.detail">
    <Card><CardHeader><CardTitle>{deck.title}</CardTitle></CardHeader><CardContent className="flex flex-col gap-6">
      {deck.slides.map((slide, index) => <section key={slide.id} className="rounded-lg border border-border p-5"><p className="mb-3 text-xs font-medium text-muted-foreground">Slide {index + 1}</p><MarkdownView content={slide.content} /></section>)}
    </CardContent></Card>
  </div>;
}
