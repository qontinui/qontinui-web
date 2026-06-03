import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - Qontinui",
  description:
    "Privacy policy for qontinui.io, including how we use error and security telemetry.",
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-text-muted mb-8">
          Last updated: 2026-06-03
        </p>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold mb-4">Overview</h2>
            <p>
              qontinui.io is a web application for building and running browser
              and desktop automations. This page explains how qontinui.io
              handles your data, with a particular focus on the technical
              error and security telemetry described below. The privacy terms
              governing your account and your use of the product are part of
              the agreement under which we provide the service; this notice
              describes the automatic technical reporting our site performs and
              your choices about it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              Error and security telemetry
            </h2>
            <p>
              When you use qontinui.io, your browser may automatically report
              technical error events to us — for example, that a page script
              failed, a network request was blocked, or a sign-in redirect did
              not complete. We use these reports solely to keep the service
              working and secure (our legitimate interest under Art. 6(1)(f)
              GDPR): they let us detect outages and misconfigurations that only
              occur in real browsers and would otherwise go unnoticed. These
              reports are engineered to contain no personal content: no names,
              emails or account identifiers, no form input, no message text, no
              full web addresses (only the site area, e.g. /users/:id), and no
              cookies or identifiers stored on your device. Your IP address is
              used only to transport the report and is discarded on receipt,
              not stored. Raw reports are kept for at most 30 days (aggregate,
              non-identifying statistics longer) and are processed on our behalf
              by Sentry (Functional Software, Inc.), acting under a
              data-processing agreement with data stored in the European Union.
              You can opt out at any time by enabling Global Privacy Control
              (GPC) or &apos;Do Not Track&apos; in your browser — your browser
              will then send no reports at all — and you have the right to
              object by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">Contact</h2>
            <p>
              For questions about this privacy policy, or to exercise your right
              to object to the processing described above:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
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
