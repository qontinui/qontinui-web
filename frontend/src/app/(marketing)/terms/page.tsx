import Link from "next/link";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        <p className="text-sm text-text-muted mb-8">
          Last updated: January 6, 2025
        </p>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold mb-4">
              1. Agreement to Terms
            </h2>
            <p>
              By accessing or using Qontinui (&quot;Service&quot;), you agree to
              be bound by these Terms of Service (&quot;Terms&quot;). If you do
              not agree to these Terms, you may not access or use the Service.
            </p>
            <p className="mt-2">
              These Terms constitute a legally binding agreement between you and
              Qontinui (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). By
              using the Service, you represent that you have read, understood,
              and agree to be bound by these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              2. Description of Service
            </h2>
            <p>
              Qontinui is a general-purpose GUI automation platform that enables
              users to create, configure, and execute automated interactions
              with graphical user interfaces. The Service includes:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                A web-based configuration interface for building automation
                workflows
              </li>
              <li>An open-source Python library for automation execution</li>
              <li>A desktop runner application for local execution</li>
              <li>Project management and export capabilities</li>
              <li>Documentation and community resources</li>
            </ul>
            <p className="mt-4">
              The Service is designed as a general-purpose tool.{" "}
              <strong>
                You, the user, are solely responsible for how you use this
                technology and ensuring your use complies with all applicable
                laws, regulations, and third-party terms of service.
              </strong>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">3. Eligibility</h2>
            <p>
              You must be at least 16 years old to use this Service. By using
              the Service, you represent and warrant that you meet this age
              requirement and have the legal capacity to enter into these Terms.
            </p>
            <p className="mt-2">
              If you are using the Service on behalf of an organization, you
              represent that you have the authority to bind that organization to
              these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              4. Account Registration
            </h2>
            <p className="mb-2">
              To use certain features of the Service, you must register for an
              account. You agree to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Provide accurate, current, and complete information during
                registration
              </li>
              <li>Maintain and promptly update your account information</li>
              <li>Keep your password secure and confidential</li>
              <li>
                Notify us immediately of any unauthorized access to your account
              </li>
              <li>
                Accept responsibility for all activities under your account
              </li>
            </ul>
            <p className="mt-4">
              You may not use another person&apos;s account without permission,
              create multiple accounts for fraudulent purposes, or share your
              account credentials.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              5. Responsible Use and User Obligations
            </h2>

            <p className="mb-4 font-semibold text-lg">
              <strong>IMPORTANT:</strong> Qontinui is a general-purpose
              automation tool. You are entirely responsible for ensuring your
              use complies with all applicable laws and third-party agreements.
            </p>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              5.1 Your Responsibilities
            </h3>
            <p className="mb-2">
              When using Qontinui, you are solely responsible for:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Compliance with Laws:</strong> Ensuring your automation
                activities comply with all applicable local, state, national,
                and international laws and regulations
              </li>
              <li>
                <strong>Third-Party Terms:</strong> Reading and complying with
                the Terms of Service, End User License Agreements (EULAs), and
                acceptable use policies of any application or service you
                automate
              </li>
              <li>
                <strong>Permission and Authorization:</strong> Only automating
                applications and services where you have explicit permission to
                do so
              </li>
              <li>
                <strong>Anti-Cheat Compliance:</strong> Not using Qontinui to
                circumvent, disable, or interfere with anti-cheat systems,
                security measures, or technical protection measures
              </li>
              <li>
                <strong>Account Risks:</strong> Understanding that automation
                may violate third-party terms of service and could result in
                account suspension, bans, or legal action by third parties
              </li>
              <li>
                <strong>Data Protection:</strong> Ensuring your automation
                activities comply with applicable data protection and privacy
                laws (GDPR, CCPA, etc.)
              </li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">
              5.2 Gaming and Online Services
            </h3>
            <p className="mb-2">
              Many users employ Qontinui for gaming automation.{" "}
              <strong>
                We explicitly do not condone or support violations of game Terms
                of Service.
              </strong>
            </p>
            <p className="mt-2 mb-2">
              If you use Qontinui with games or online services, you acknowledge
              and agree that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Many games prohibit automation in their Terms of Service</li>
              <li>Using automation may result in permanent account bans</li>
              <li>
                You may not use Qontinui to gain unfair competitive advantages
                in multiplayer or competitive environments
              </li>
              <li>
                You may not use Qontinui to circumvent anti-cheat systems or
                security measures
              </li>
              <li>
                You accept all risks associated with using automation in games,
                including account loss
              </li>
              <li>
                We provide no warranty that our Service will work in any
                specific game or avoid detection
              </li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">
              5.3 Recommended and Discouraged Use Cases
            </h3>

            <p className="mt-2 mb-2">
              <strong>Recommended Use Cases (Low Risk):</strong>
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Single-player games where automation does not violate terms of
                service
              </li>
              <li>
                Applications you own or have explicit permission to automate
              </li>
              <li>Software testing and quality assurance</li>
              <li>Productivity automation for personal workflows</li>
              <li>Educational and research purposes</li>
              <li>Game development and testing (your own games)</li>
            </ul>

            <p className="mt-4 mb-2">
              <strong>
                Discouraged Use Cases (High Risk - Proceed at Your Own Risk):
              </strong>
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Multiplayer or competitive games (likely violates ToS)</li>
              <li>Online games with anti-cheat systems (high ban risk)</li>
              <li>Applications that explicitly prohibit automation</li>
              <li>Any use that provides unfair competitive advantage</li>
              <li>
                Commercial use on third-party platforms without permission
              </li>
            </ul>

            <h3 className="text-xl font-semibold mt-6 mb-2">
              5.4 No Circumvention Tools Provided
            </h3>
            <p>
              <strong>
                Qontinui does not include, provide, or support tools for
                circumventing anti-cheat systems, security measures, or
                technical protection measures.
              </strong>{" "}
              Our software operates as a general-purpose automation platform.
              Any methods for avoiding detection or bypassing security systems
              are:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Not provided by us</li>
              <li>Not supported by us</li>
              <li>
                Entirely your responsibility if you choose to develop or use
                them
              </li>
              <li>
                Potentially illegal under laws such as the DMCA (U.S.) or
                equivalent laws in other jurisdictions
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              6. Subscription Plans and Billing
            </h2>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              6.1 Free and Paid Plans
            </h3>
            <p>
              We offer both free and paid subscription plans. The features,
              limitations, and pricing for each plan are described on our
              website at qontinui.com.
            </p>

            <h3 className="text-xl font-semibold mt-4 mb-2">6.2 Payment</h3>
            <p>
              Paid subscriptions are billed in advance on a recurring basis
              (monthly or annually). You authorize us to charge your payment
              method for all fees associated with your subscription. Payment
              processing is handled by Stripe.
            </p>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              6.3 Automatic Renewal
            </h3>
            <p>
              Your subscription will automatically renew at the end of each
              billing period unless you cancel before the renewal date. You will
              be charged the then-current rate for your plan.
            </p>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              6.4 Cancellation and Refunds
            </h3>
            <p>
              You may cancel your subscription at any time through your account
              settings. Cancellations take effect at the end of the current
              billing period. We do not provide refunds for partial months or
              unused portions of your subscription, except as required by law or
              in cases of service failure on our part.
            </p>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              6.5 Price Changes
            </h3>
            <p>
              We reserve the right to change our pricing. We will provide at
              least 30 days&apos; notice before any price increase takes effect
              for existing subscribers. Your continued use of the Service after
              a price change constitutes acceptance of the new pricing.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">7. Prohibited Uses</h2>
            <p className="mb-2">
              In addition to the responsibilities outlined in Section 5, you
              explicitly agree not to:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Violate any applicable laws or regulations</li>
              <li>Infringe on intellectual property rights of others</li>
              <li>Upload malicious code, viruses, or harmful content</li>
              <li>
                Attempt to gain unauthorized access to our systems or other
                users&apos; accounts
              </li>
              <li>Interfere with or disrupt the Service or our servers</li>
              <li>Use the Service to harass, abuse, or harm others</li>
              <li>Scrape, crawl, or spider the Service without permission</li>
              <li>
                Reverse engineer or attempt to extract source code from the
                proprietary components of the Service (the hosted coordination
                service; the web interface and backend are open source under
                AGPL-3.0 and governed by that license)
              </li>
              <li>Use the Service for any illegal or unauthorized purpose</li>
              <li>
                Resell or redistribute the Service without our written consent
              </li>
              <li>
                Use Qontinui to create automation that violates third-party
                terms of service in a manner that causes harm to those third
                parties or their users
              </li>
              <li>
                Use Qontinui in connection with any activity that could subject
                us to legal liability or damage our reputation
              </li>
            </ul>
            <p className="mt-4">
              For complete details on acceptable use, please review our{" "}
              <Link
                href="/acceptable-use"
                className="text-blue-600 hover:underline"
              >
                Acceptable Use Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              8. Intellectual Property
            </h2>

            <h3 className="text-xl font-semibold mt-4 mb-2">8.1 Our Rights</h3>
            <p>
              The Service, including all content, features, and functionality
              (excluding open-source components), is owned by Qontinui and is
              protected by copyright, trademark, and other intellectual property
              laws. You are granted a limited, non-exclusive, non-transferable
              license to access and use the Service for its intended purpose.
            </p>
            <p className="mt-2">
              Our open-source components (qontinui Python library,
              qontinui-runner, qontinui-web, qontinui-cloud-control, and others)
              are licensed under the GNU Affero General Public License v3.0 or
              later (AGPL-3.0) and subject to the terms of that license.
            </p>

            <h3 className="text-xl font-semibold mt-4 mb-2">
              8.2 Your Content
            </h3>
            <p>
              You retain all rights to the automation configurations, projects,
              and other content you create using the Service (&quot;Your
              Content&quot;). By uploading Your Content, you grant us a limited
              license to store, process, and display it solely for the purpose
              of providing the Service to you.
            </p>
            <p className="mt-2">
              You represent and warrant that you own or have the necessary
              rights to Your Content and that it does not violate any
              third-party rights or laws.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">9. Data and Privacy</h2>
            <p>
              Your use of the Service is governed by our Privacy Policy, which
              is incorporated into these Terms by reference. Please review our
              Privacy Policy at qontinui.com/privacy to understand how we
              collect, use, and protect your data.
            </p>
            <p className="mt-2">
              The desktop runner (qontinui-runner) executes automation locally
              on your machine. We do not collect or have access to the content
              you automate, screenshots you capture, or applications you
              interact with using the local runner.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              10. Service Availability
            </h2>
            <p>
              We strive to provide reliable service, but we do not guarantee
              that the Service will be available at all times or without
              interruption. We may modify, suspend, or discontinue any part of
              the Service at any time with or without notice.
            </p>
            <p className="mt-2">
              We are not responsible for any loss or damage resulting from
              service downtime, maintenance, technical issues, or your inability
              to access third-party applications.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              11. Third-Party Services and Applications
            </h2>
            <p>
              Qontinui enables you to interact with third-party applications,
              games, and services.{" "}
              <strong>
                We are not affiliated with, endorsed by, or responsible for any
                third-party services you choose to automate.
              </strong>
            </p>
            <p className="mt-2">You acknowledge that:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                Your use of third-party applications is governed by their own
                terms of service
              </li>
              <li>
                We are not responsible for changes to third-party applications
                that affect Qontinui&apos;s functionality
              </li>
              <li>
                We are not liable for any consequences resulting from your
                automation of third-party applications
              </li>
              <li>
                Third parties may take action against you for violating their
                terms, including but not limited to account suspension or legal
                action
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              12. Disclaimer of Warranties
            </h2>
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR
              IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT.
            </p>
            <p className="mt-2">
              We specifically disclaim any warranties that:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>
                The Service will function with any specific third-party
                application
              </li>
              <li>
                Your use of the Service will not result in third-party account
                bans or suspensions
              </li>
              <li>
                Automation created with the Service will avoid detection by
                anti-cheat systems
              </li>
              <li>Your use will comply with third-party terms of service</li>
              <li>
                The Service will be uninterrupted, error-free, secure, or free
                of viruses
              </li>
            </ul>
            <p className="mt-4">
              <strong>YOU USE THE SERVICE ENTIRELY AT YOUR OWN RISK.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              13. Limitation of Liability
            </h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, QONTINUI SHALL NOT BE
              LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
              PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Loss of profits, data, or use</li>
              <li>Account bans or suspensions by third parties</li>
              <li>Legal action taken against you by third parties</li>
              <li>Damage to your reputation</li>
              <li>
                Any other damages arising out of or related to your use of the
                Service
              </li>
            </ul>
            <p className="mt-4">
              OUR TOTAL LIABILITY TO YOU FOR ANY CLAIMS ARISING FROM THESE TERMS
              OR YOUR USE OF THE SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID US
              IN THE 12 MONTHS PRECEDING THE CLAIM, OR $100 USD, WHICHEVER IS
              GREATER.
            </p>
            <p className="mt-2">
              Some jurisdictions do not allow the exclusion or limitation of
              certain warranties or liabilities, so the above limitations may
              not apply to you.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">14. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless Qontinui, its
              affiliates, and their respective officers, directors, employees,
              and agents from any claims, liabilities, damages, losses, or
              expenses (including reasonable attorneys&apos; fees) arising out
              of or related to:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Your use of the Service</li>
              <li>
                Your violation of these Terms or our Acceptable Use Policy
              </li>
              <li>Your violation of any third-party terms of service</li>
              <li>Your violation of any rights of another party</li>
              <li>Your Content</li>
              <li>Any automation you create or execute using the Service</li>
              <li>
                Any legal action taken against you by third parties related to
                your use of the Service
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">15. Termination</h2>
            <p>
              We may terminate or suspend your account and access to the Service
              immediately, without prior notice or liability, for any reason,
              including if you breach these Terms or our Acceptable Use Policy,
              or if we receive legal demands from third parties related to your
              use of the Service.
            </p>
            <p className="mt-2">
              Upon termination, your right to use the Service will cease
              immediately. We may delete your account and Your Content within 30
              days of termination, except where we are required to retain it for
              legal purposes.
            </p>
            <p className="mt-2">
              You may terminate your account at any time by contacting us or
              through your account settings.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              16. Governing Law and Disputes
            </h2>
            <p>
              These Terms are governed by the laws of the United States and the
              State of [Your State - Update This], without regard to conflicts
              of law provisions.
            </p>
            <p className="mt-2">
              Any disputes arising from these Terms or your use of the Service
              shall be resolved through binding arbitration in accordance with
              the rules of the American Arbitration Association, except that
              either party may seek injunctive relief in court for intellectual
              property disputes or violations of these Terms.
            </p>
            <p className="mt-2">
              <strong>Class Action Waiver:</strong> You agree that any
              arbitration or proceeding shall be limited to the dispute between
              you and Qontinui individually. You waive any right to participate
              in any class action, class arbitration, or other representative
              proceeding.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              17. Changes to Terms
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. We will
              notify you of material changes by posting the updated Terms on our
              website and updating the &quot;Last updated&quot; date. For
              significant changes, we may also send email notification.
            </p>
            <p className="mt-2">
              Your continued use of the Service after changes take effect
              constitutes acceptance of the modified Terms. If you do not agree
              to the changes, you must stop using the Service and cancel your
              account.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">18. Severability</h2>
            <p>
              If any provision of these Terms is found to be invalid or
              unenforceable, that provision will be limited or eliminated to the
              minimum extent necessary, and the remaining provisions will remain
              in full force and effect.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              19. Entire Agreement
            </h2>
            <p>
              These Terms, together with our Privacy Policy and Acceptable Use
              Policy, constitute the entire agreement between you and Qontinui
              regarding your use of the Service and supersede all prior
              agreements and understandings.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">20. Export Control</h2>
            <p>
              The Service may be subject to export control laws. You agree to
              comply with all applicable export and re-export control laws and
              regulations, including the U.S. Export Administration Regulations.
              You represent that you are not located in a country subject to
              U.S. government embargo or designated as a &quot;terrorist
              supporting&quot; country, and that you are not on any U.S.
              government list of prohibited or restricted parties.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4">
              21. Contact Information
            </h2>
            <p>
              If you have questions or concerns about these Terms, please
              contact us at:
            </p>
            <p className="mt-2">
              <strong>Qontinui</strong>
              <br />
              Email: jspinak@alum.mit.edu
              <br />
              Website: qontinui.com
            </p>
          </section>

          <section className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">
              ⚠️ Important Reminders
            </h3>
            <ul className="list-disc pl-6 space-y-2 text-sm">
              <li>
                <strong>Read Third-Party Terms:</strong> Always read and comply
                with the Terms of Service of any application you automate.
              </li>
              <li>
                <strong>Automation = Risk:</strong> Automation may violate terms
                of service and result in account bans. Use at your own risk.
              </li>
              <li>
                <strong>We Don&apos;t Provide Circumvention:</strong> Qontinui
                does not include anti-cheat bypass tools. You are responsible
                for any methods you develop.
              </li>
              <li>
                <strong>Recommended Use:</strong> Single-player games, your own
                applications, testing/QA, educational purposes, and productivity
                automation are lower-risk use cases.
              </li>
              <li>
                <strong>You Are Responsible:</strong> You accept all legal and
                practical consequences of your automation activities.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
