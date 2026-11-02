/**
 * A page-shaped module for `readinessTargets.test.ts`: its default export is
 * the component the readiness loader must load as this module's own, while
 * that test mocks the module with a stand-in.
 */
export default function ReadinessFixturePage() {
  return <main>Fixture page</main>;
}
