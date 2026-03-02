"use client";

import { mockWorkflows, mockStates, mockImages } from "./demo-mock-data";

export function DemoDataPreview() {
  return (
    <div className="p-6 border rounded-lg bg-card">
      <h2 className="text-xl font-semibold mb-4">Mock Data Preview</h2>

      <div className="space-y-4">
        <div>
          <h3 className="font-medium mb-2">Workflows</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            {mockWorkflows.map((wf) => (
              <li key={wf.id}>
                <span className="font-medium text-foreground">{wf.name}</span> -{" "}
                {wf.description}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-medium mb-2">States</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            {mockStates.map((st) => (
              <li key={st.id}>
                <span className="font-medium text-foreground">{st.name}</span> -{" "}
                {st.description}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-medium mb-2">Images</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            {mockImages.map((img) => (
              <li key={img.id}>
                <span className="font-medium text-foreground">{img.name}</span>{" "}
                - Used {img.usageCount} times
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
