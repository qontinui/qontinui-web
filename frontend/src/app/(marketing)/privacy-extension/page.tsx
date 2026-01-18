import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browser Extension Privacy Policy - Qontinui",
  description:
    "Privacy policy for the Qontinui Capture browser extension. Learn how the extension handles your data.",
};

export default function ExtensionPrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-2">
          Privacy Policy for Qontinui Capture Browser Extension
        </h1>
        <p className="text-sm text-text-muted mb-8">Last updated: January 2026</p>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold mb-4">Overview</h2>
            <p>
              Qontinui Capture is a browser extension that captures web page
              content (DOM and HTTP requests) and sends it to the Qontinui Runner
              application running on your local computer. This privacy policy
              explains what data the extension accesses and how it is handled.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              Data Collection
            </h2>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              What We DO NOT Collect
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>We do not collect personal information</li>
              <li>We do not track your browsing history</li>
              <li>We do not use analytics or telemetry</li>
              <li>We do not transmit any data to external servers</li>
              <li>We do not store data in the cloud</li>
              <li>We do not share data with third parties</li>
            </ul>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              What the Extension Accesses
            </h3>
            <p className="mb-2">
              When you explicitly click the extension icon and initiate a
              capture, the extension accesses:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Page DOM:</strong> The HTML structure of the current web
                page
              </li>
              <li>
                <strong>HTTP Requests:</strong> Network requests made by the page
                (method, URL, headers, response data)
              </li>
              <li>
                <strong>Page URL and Title:</strong> The address and title of the
                captured page
              </li>
            </ul>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              Where Data Goes
            </h3>
            <p>All captured data is sent exclusively to:</p>
            <pre className="bg-gray-100 p-4 rounded-lg mt-2 text-sm">
              http://localhost:9876
            </pre>
            <p className="mt-2">
              This is a local server running on YOUR computer as part of the
              Qontinui Runner desktop application.{" "}
              <strong>Data never leaves your machine.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              Permissions Explained
            </h2>
            <p className="mb-4">
              The extension requests the following permissions:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-semibold">
                      Permission
                    </th>
                    <th className="text-left py-2 font-semibold">
                      Why It&apos;s Needed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 pr-4">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        activeTab
                      </code>
                    </td>
                    <td className="py-2">
                      To capture the DOM of the page you&apos;re viewing
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        scripting
                      </code>
                    </td>
                    <td className="py-2">
                      To execute the capture script on the page
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        webRequest
                      </code>
                    </td>
                    <td className="py-2">
                      To intercept and record HTTP requests
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        storage
                      </code>
                    </td>
                    <td className="py-2">
                      To remember your preferences (like last used selector)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-4">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        &lt;all_urls&gt;
                      </code>
                    </td>
                    <td className="py-2">
                      To capture content from any website you choose
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">User Control</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>The extension only activates when you click its icon</li>
              <li>You choose which pages to capture</li>
              <li>You can disable or uninstall the extension at any time</li>
              <li>No background data collection occurs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Data Storage</h2>
            <p>
              The extension stores minimal data locally in your browser:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Connection status preferences</li>
              <li>Last used CSS selector (for convenience)</li>
            </ul>
            <p className="mt-2">
              This data is stored using Chrome&apos;s local storage API and never
              transmitted anywhere.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              Children&apos;s Privacy
            </h2>
            <p>
              This extension is a developer tool not directed at children under
              13. We do not knowingly collect information from children.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              Changes to This Policy
            </h2>
            <p>
              We may update this privacy policy from time to time. Changes will
              be posted at this URL with an updated &quot;Last updated&quot;
              date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Open Source</h2>
            <p>
              This extension is open source. You can review the complete source
              code at:
            </p>
            <p className="mt-2">
              <a
                href="https://github.com/qontinui/qontinui-runner/tree/main/extension"
                className="text-blue-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/qontinui/qontinui-runner/tree/main/extension
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p>
              For questions about this privacy policy or the extension:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                GitHub Issues:{" "}
                <a
                  href="https://github.com/qontinui/qontinui-runner/issues"
                  className="text-blue-600 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/qontinui/qontinui-runner/issues
                </a>
              </li>
              <li>
                Email:{" "}
                <a
                  href="mailto:contact@qontinui.com"
                  className="text-blue-600 hover:underline"
                >
                  contact@qontinui.com
                </a>
              </li>
              <li>
                Website:{" "}
                <a
                  href="https://qontinui.io"
                  className="text-blue-600 hover:underline"
                >
                  qontinui.io
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
