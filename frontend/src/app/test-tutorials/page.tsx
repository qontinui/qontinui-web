'use client';

import { useEffect, useState } from 'react';

export default function TestTutorialsPage() {
  const [status, setStatus] = useState<string>('Loading...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function testImports() {
      try {
        setStatus('Importing tutorials...');

        // Test individual imports
        const firstAuto = await import('@/data/tutorials/workflow-builder/first-automation');
        setStatus(`✓ first-automation loaded: ${firstAuto.default?.id}`);

        const visual = await import('@/data/tutorials/workflow-builder/visual-workflow');
        setStatus(`✓ visual-workflow loaded: ${visual.default?.id}`);

        const annotation = await import('@/data/tutorials/image-annotation/annotation-basics');
        setStatus(`✓ annotation-basics loaded: ${annotation.default?.id}`);

        const civ6 = await import('@/data/tutorials/civ6-early-game');
        setStatus(`✓ civ6-early-game loaded: ${civ6.civ6EarlyGameTutorial?.id}`);

        setStatus('✓ All tutorials loaded successfully!');
      } catch (err: any) {
        setError(err.message || String(err));
        setStatus('✗ Error loading tutorials');
      }
    }

    testImports();
  }, []);

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Tutorial Import Test</h1>
      <div style={{ marginTop: '1rem' }}>
        <p><strong>Status:</strong> {status}</p>
        {error && (
          <div style={{ color: 'red', marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>
    </div>
  );
}
