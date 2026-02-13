import { TestTube2, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function GettingStarted({
  onCreateTest,
}: {
  onCreateTest: () => void;
}) {
  return (
    <Card>
      <CardContent className="py-12">
        <div className="text-center max-w-md mx-auto">
          <TestTube2 className="size-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Get Started with Testing</h2>
          <p className="text-muted-foreground mb-6">
            Create your first test case to validate workflow behavior and ensure
            quality
          </p>
          <Button onClick={onCreateTest} size="lg">
            <Plus className="size-5" />
            Create Your First Test
          </Button>

          <div className="mt-8 space-y-4 text-left">
            <h3 className="font-semibold">Quick Tips:</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0" />
                <span>Create test cases to validate specific scenarios</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0" />
                <span>
                  Group related tests into suites for organized execution
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0" />
                <span>Monitor coverage to identify untested workflows</span>
              </li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
