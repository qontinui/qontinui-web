import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownView } from "@/components/overview/MarkdownView";
import { scenarioA } from "../../../mock-data";

export default async function Presenter({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const deck = scenarioA.slides.find((item) => item.id === slug);
  if (!deck) notFound();
  const slide = deck.slides[0];
  return <main className="flex min-h-screen items-center justify-center bg-background p-6" data-ui-bridge-id="overview.slides.presenter">
    <Card className="aspect-video w-full max-w-6xl"><CardContent className="flex h-full items-center justify-center p-12"><MarkdownView content={slide?.content ?? "No slides available."} /></CardContent></Card>
  </main>;
}
