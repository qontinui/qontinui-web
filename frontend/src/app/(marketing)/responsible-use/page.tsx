import Link from "next/link";

export default function ResponsibleUseFAQ() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">Responsible Use FAQ</h1>
        <p className="text-sm text-text-muted mb-8">
          Last updated: January 6, 2025
        </p>

        <div className="space-y-8 text-muted-foreground">
          {/* Introduction */}
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-text-primary">
              Welcome to Qontinui
            </h2>
            <p className="mb-4">
              This FAQ is designed to help you understand how to use Qontinui
              safely, legally, and ethically. We want you to get the most out of
              our automation platform while avoiding common pitfalls that could
              lead to account bans, legal issues, or other problems.
            </p>
            <p className="mb-4 font-semibold">
              Key principle: You are responsible for how you use Qontinui. We
              provide the technology; you decide how to apply it.
            </p>
            <p>
              For complete legal details, see our{" "}
              <Link href="/terms" className="text-blue-600 hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                href="/acceptable-use"
                className="text-blue-600 hover:underline"
              >
                Acceptable Use Policy
              </Link>
              .
            </p>
          </section>

          {/* Quick Reference */}
          <section className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-text-primary">
              Quick Reference: Safe vs. Risky Use
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-green-800">
                  Recommended (Low Risk)
                </h3>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Single-player games (check ToS)</li>
                  <li>Your own applications</li>
                  <li>Software testing/QA</li>
                  <li>Personal productivity</li>
                  <li>Educational purposes</li>
                  <li>Game development (your games)</li>
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2 text-red-800">
                  High Risk (Proceed with Caution)
                </h3>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>Multiplayer/competitive games</li>
                  <li>Games with anti-cheat systems</li>
                  <li>Online games (even PvE)</li>
                  <li>Apps that prohibit automation</li>
                  <li>Commercial use on 3rd party platforms</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Getting Started */}
          <section>
            <h2 className="text-3xl font-bold mb-6 text-text-primary">
              Getting Started
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What is Qontinui?
                </h3>
                <p>
                  Qontinui is a general-purpose GUI automation platform that
                  uses computer vision and AI models to automate interactions
                  with graphical user interfaces. Unlike traditional automation
                  tools that rely on hardcoded coordinates or element selectors,
                  Qontinui uses visual recognition to understand what&apos;s on
                  your screen and interact with it intelligently.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How does Qontinui work?
                </h3>
                <p className="mb-2">
                  Qontinui operates through three main components:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Web Interface:</strong> Where you design and
                    configure your automation workflows visually
                  </li>
                  <li>
                    <strong>Desktop Runner:</strong> A local application that
                    executes your automation on your computer
                  </li>
                  <li>
                    <strong>Python Library:</strong> The open-source engine that
                    powers the automation (available on GitHub)
                  </li>
                </ul>
                <p className="mt-2">
                  All automation runs locally on your machine. We don&apos;t see
                  or store what you&apos;re automating.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What is model-based automation?
                </h3>
                <p>
                  Model-based automation uses AI/ML models (like computer vision
                  and pattern recognition) to identify elements on screen rather
                  than relying on fixed coordinates or DOM selectors. This makes
                  automation more flexible and resilient to UI changes, but it
                  also means the automation operates similarly to how a human
                  would view and interact with a screen.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Do I need programming experience?
                </h3>
                <p>
                  No! Qontinui&apos;s web interface is designed to be
                  user-friendly with visual workflow builders. However, if you
                  do have Python experience, you can use our open-source library
                  directly for more advanced use cases.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What&apos;s your demo game and why Civilization VI?
                </h3>
                <p>We showcase Civilization VI because it&apos;s:</p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Primarily single-player (low risk)</li>
                  <li>Turn-based strategy (easier to automate safely)</li>
                  <li>No real-time competitive advantage concerns</li>
                  <li>
                    Great for demonstrating complex decision-making automation
                  </li>
                  <li>
                    Has no intrusive anti-cheat systems in single-player mode
                  </li>
                </ul>
                <p className="mt-2 text-sm italic">
                  Note: Always check the current Terms of Service for any game,
                  including Civilization VI.
                </p>
              </div>
            </div>
          </section>

          {/* Legal and Safety */}
          <section>
            <h2 className="text-3xl font-bold mb-6 text-text-primary">
              Legal and Safety
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Is using Qontinui legal?
                </h3>
                <p>
                  <strong>Yes, Qontinui itself is legal software.</strong>{" "}
                  It&apos;s a general-purpose automation tool, like scripting
                  languages, macro recorders, or other automation platforms.
                  However, <strong>how you use it</strong> may or may not be
                  legal depending on:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>The applications you automate</li>
                  <li>The terms of service of those applications</li>
                  <li>Your local laws and regulations</li>
                  <li>
                    Whether you bypass security measures or anti-cheat systems
                  </li>
                </ul>
                <p className="mt-2 font-semibold">
                  You are responsible for ensuring your use complies with all
                  applicable laws and third-party agreements.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Will I get banned for using automation in games?
                </h3>
                <p className="mb-2">
                  <strong>It depends on the game, but the risk is real.</strong>
                </p>
                <p className="mb-2">
                  Most online games and many multiplayer games explicitly
                  prohibit automation in their Terms of Service. If detected,
                  consequences can include:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Temporary suspension</li>
                  <li>Permanent account ban</li>
                  <li>Loss of all purchased content and progress</li>
                  <li>IP or hardware ID bans</li>
                  <li>In extreme cases, legal action</li>
                </ul>
                <p className="mt-2">
                  <strong>
                    Single-player offline games typically carry lower risk,
                  </strong>{" "}
                  but you must still check each game&apos;s Terms of Service.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Does Qontinui bypass anti-cheat systems?
                </h3>
                <p>
                  <strong>
                    No. Qontinui does not include, provide, or support tools for
                    bypassing anti-cheat systems.
                  </strong>
                </p>
                <p className="mt-2">
                  Qontinui is a standard automation tool that operates at the
                  user interface level, similar to how a human would interact
                  with an application. We do not develop, distribute, or
                  support:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Anti-cheat bypass techniques</li>
                  <li>Memory manipulation tools</li>
                  <li>Code injection methods</li>
                  <li>Detection avoidance systems</li>
                  <li>Rootkits or kernel-level modifications</li>
                </ul>
                <p className="mt-2 font-semibold">
                  Attempting to bypass anti-cheat systems may violate laws like
                  the DMCA and is not supported by our service.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can anti-cheat systems detect Qontinui?
                </h3>
                <p>
                  <strong>Yes, they can.</strong> Anti-cheat systems use various
                  detection methods including:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Behavioral analysis (detecting non-human patterns)</li>
                  <li>Input timing analysis</li>
                  <li>Process monitoring</li>
                  <li>Screen capture detection</li>
                  <li>Statistical anomaly detection</li>
                </ul>
                <p className="mt-2">
                  We provide no guarantees that automation will avoid detection.{" "}
                  <strong>
                    If you use automation in games with anti-cheat systems, you
                    do so at your own risk.
                  </strong>
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What if I get banned from a game?
                </h3>
                <p>
                  <strong>
                    We are not responsible for bans or other consequences from
                    third-party services.
                  </strong>{" "}
                  When you use Qontinui to automate applications:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>You accept all risks, including account loss</li>
                  <li>Bans are between you and the game/service provider</li>
                  <li>We cannot help you appeal bans or recover accounts</li>
                  <li>
                    You are not entitled to refunds of Qontinui subscription
                    fees
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Are there laws I need to worry about?
                </h3>
                <p className="mb-2">
                  <strong>Yes.</strong> Depending on how you use automation,
                  these laws may apply:
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Computer Fraud and Abuse Act (CFAA) - U.S.:</strong>{" "}
                    Prohibits unauthorized access to computer systems
                  </li>
                  <li>
                    <strong>
                      Digital Millennium Copyright Act (DMCA) - U.S.:
                    </strong>{" "}
                    Prohibits circumventing technical protection measures
                  </li>
                  <li>
                    <strong>GDPR - EU:</strong> Governs data collection and
                    privacy
                  </li>
                  <li>
                    <strong>CCPA - California:</strong> Privacy and data
                    protection
                  </li>
                  <li>
                    <strong>Local computer crime laws:</strong> Vary by
                    jurisdiction
                  </li>
                </ul>
                <p className="mt-2">
                  <strong>
                    We strongly recommend consulting with a lawyer if
                    you&apos;re unsure about the legality of your intended use.
                  </strong>
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What if my country has different laws?
                </h3>
                <p>
                  <strong>You must comply with your local laws,</strong> which
                  may be more restrictive than U.S. laws. Some countries have
                  stricter computer crime laws or different interpretations of
                  automation legality. Research your jurisdiction&apos;s laws or
                  consult a local attorney.
                </p>
              </div>
            </div>
          </section>

          {/* Gaming Automation */}
          <section>
            <h2 className="text-3xl font-bold mb-6 text-text-primary">
              Gaming Automation
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Which games are safe to automate?
                </h3>
                <p className="mb-2">
                  <strong>Generally, the safest games to automate are:</strong>
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Single-player offline games:</strong> No online
                    components, no competitive elements
                  </li>
                  <li>
                    <strong>Games you developed:</strong> For testing and
                    development purposes
                  </li>
                  <li>
                    <strong>Sandbox/creative games:</strong> Where automation
                    doesn&apos;t affect others (check ToS)
                  </li>
                </ul>
                <p className="mt-2 font-semibold">
                  However, you must ALWAYS check the specific game&apos;s Terms
                  of Service. Even single-player games may prohibit automation.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can I automate multiplayer games?
                </h3>
                <p>
                  <strong>Not recommended.</strong> Almost all multiplayer games
                  prohibit automation in their Terms of Service. Using
                  automation in multiplayer games:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Violates ToS (very high ban risk)</li>
                  <li>Provides unfair competitive advantage</li>
                  <li>Harms other players&apos; experience</li>
                  <li>Often violates our Acceptable Use Policy</li>
                  <li>May be illegal under CFAA or similar laws</li>
                </ul>
                <p className="mt-2">
                  <strong>
                    We explicitly do not support or condone automation in
                    competitive multiplayer environments.
                  </strong>
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What about PvE (Player vs. Environment) grinding in online
                  games?
                </h3>
                <p>
                  <strong>Still risky.</strong> Even in non-competitive PvE
                  scenarios like resource farming or level grinding:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Most online games prohibit all automation</li>
                  <li>Anti-cheat systems may detect it</li>
                  <li>Can result in permanent bans</li>
                  <li>
                    May affect in-game economy or other players indirectly
                  </li>
                </ul>
                <p className="mt-2">
                  If you proceed despite these risks, you do so entirely at your
                  own risk and accept full responsibility for consequences.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Which popular games definitely prohibit automation?
                </h3>
                <p className="mb-2">
                  <strong>
                    Most popular online games explicitly prohibit automation,
                  </strong>{" "}
                  including (but not limited to):
                </p>
                <ul className="list-disc pl-6 space-y-1 text-sm">
                  <li>World of Warcraft, Final Fantasy XIV (MMORPGs)</li>
                  <li>League of Legends, Dota 2 (MOBAs)</li>
                  <li>Counter-Strike, Valorant, Overwatch (FPS)</li>
                  <li>Fortnite, Apex Legends, PUBG (Battle Royale)</li>
                  <li>RuneScape, EVE Online (MMOs)</li>
                  <li>Any game with EasyAntiCheat, BattlEye, Vanguard, etc.</li>
                </ul>
                <p className="mt-2 text-sm italic">
                  This is not a complete list. Always check the specific
                  game&apos;s current Terms of Service.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How do I check if a game allows automation?
                </h3>
                <p className="mb-2">
                  <strong>Follow these steps:</strong>
                </p>
                <ol className="list-decimal pl-6 space-y-2">
                  <li>
                    Find and read the game&apos;s Terms of Service (ToS) or End
                    User License Agreement (EULA)
                  </li>
                  <li>
                    Search for keywords: &quot;bot,&quot;
                    &quot;automation,&quot; &quot;macro,&quot; &quot;third-party
                    software,&quot; &quot;unfair advantage&quot;
                  </li>
                  <li>
                    Check the game&apos;s official forums or FAQ for automation
                    policies
                  </li>
                  <li>Look for community guidelines or code of conduct</li>
                  <li>When in doubt, contact the game developer directly</li>
                </ol>
                <p className="mt-2 font-semibold">
                  If the ToS is unclear, assume automation is prohibited.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What about accessibility features? Can I use automation to
                  help with disabilities?
                </h3>
                <p>
                  <strong>This is a nuanced area.</strong> Some games make
                  exceptions for accessibility purposes, but:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>You must still comply with the game&apos;s ToS</li>
                  <li>
                    Some games have official accessibility features built-in
                  </li>
                  <li>
                    Contact the game developer to request permission or
                    clarification
                  </li>
                  <li>Document any permissions you receive</li>
                  <li>
                    Even with good intentions, you may still face bans without
                    explicit permission
                  </li>
                </ul>
                <p className="mt-2">
                  We support making games more accessible, but you must work
                  within each game&apos;s rules.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can I sell automation services or bots for games?
                </h3>
                <p>
                  <strong>No.</strong> Creating and selling game bots or
                  automation services:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Almost certainly violates game ToS</li>
                  <li>May violate our Acceptable Use Policy</li>
                  <li>Could expose you to legal action from game developers</li>
                  <li>May constitute tortious interference with contracts</li>
                  <li>We will terminate accounts engaged in this activity</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What about games that are no longer supported or offline?
                </h3>
                <p>
                  <strong>Lower risk, but not zero risk.</strong> For games that
                  have been discontinued or are fully offline:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Terms of Service may still technically apply</li>
                  <li>
                    No practical enforcement mechanism if servers are offline
                  </li>
                  <li>
                    Still worth checking if any legal agreements remain in
                    effect
                  </li>
                  <li>Generally, this is one of the safest scenarios</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Technical Questions */}
          <section>
            <h2 className="text-3xl font-bold mb-6 text-text-primary">
              Technical Questions
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Does Qontinui require admin/root privileges?
                </h3>
                <p>
                  The Qontinui runner may require elevated privileges for
                  certain operations like simulating input or capturing
                  screenshots, depending on your operating system. We only
                  request the minimum permissions necessary for functionality.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Does Qontinui inject code into other applications?
                </h3>
                <p>
                  <strong>No.</strong> Qontinui operates at the user interface
                  level, similar to how a human interacts with applications. We
                  do not inject code, modify memory, or hook into other
                  processes. We use screen capture and input simulation APIs
                  provided by the operating system.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What data does Qontinui collect?
                </h3>
                <p className="mb-2">
                  <strong>
                    The desktop runner executes locally on your machine.
                  </strong>{" "}
                  We do not collect or see:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Screenshots or screen content from your automation</li>
                  <li>Which applications you automate</li>
                  <li>Credentials or personal data processed by automation</li>
                  <li>Game content or in-game activities</li>
                </ul>
                <p className="mt-2">
                  We do collect standard analytics like account usage, feature
                  utilization, and error reports. See our Privacy Policy for
                  details.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can I use Qontinui with virtual machines or cloud gaming?
                </h3>
                <p>
                  <strong>Yes, technically,</strong> but be aware:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>Some games prohibit running in VMs</li>
                  <li>Performance may be reduced</li>
                  <li>Anti-cheat systems may detect VM environments</li>
                  <li>
                    Cloud gaming platforms have their own terms to comply with
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What operating systems are supported?
                </h3>
                <p>
                  Qontinui currently supports Windows, macOS, and Linux.
                  Specific feature availability may vary by platform. Check our
                  documentation for the most current compatibility information.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can I inspect the source code?
                </h3>
                <p>
                  <strong>Partially.</strong> Our Python library (qontinui) and
                  desktop runner (qontinui-runner) are open source and available
                  on GitHub. The web interface and backend are proprietary. You
                  can review how the automation engine works and verify it
                  doesn&apos;t contain malicious code.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How is this different from traditional macro tools?
                </h3>
                <p>
                  Traditional macro tools record and replay mouse/keyboard
                  inputs at fixed coordinates. Qontinui uses computer vision and
                  AI to understand what&apos;s on screen, making automation more
                  flexible and resilient to UI changes. This model-based
                  approach can adapt to different screen resolutions, window
                  positions, and UI variations.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can Qontinui work with games that use DirectX or OpenGL?
                </h3>
                <p>
                  Yes, Qontinui can capture and analyze screens from games using
                  various graphics APIs. However, some games may have
                  protections that prevent screen capture or detect it as
                  suspicious activity.
                </p>
              </div>
            </div>
          </section>

          {/* Pricing and Plans */}
          <section>
            <h2 className="text-3xl font-bold mb-6 text-text-primary">
              Pricing and Plans
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How much does Qontinui cost?
                </h3>
                <p>
                  We offer both free and paid subscription plans. The free tier
                  includes basic features with usage limitations. Paid plans
                  offer advanced features, higher usage limits, and priority
                  support. Visit qontinui.com/pricing for current pricing
                  details.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What&apos;s included in the free plan?
                </h3>
                <p className="mb-2">The free plan includes:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Access to the web interface and workflow builder</li>
                  <li>Basic automation features</li>
                  <li>Limited project storage</li>
                  <li>Community support</li>
                  <li>Desktop runner (open source)</li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Can I cancel anytime?
                </h3>
                <p>
                  <strong>Yes.</strong> You can cancel your subscription at any
                  time through your account settings. Cancellations take effect
                  at the end of your current billing period. We do not provide
                  refunds for partial months unless required by law or in cases
                  of service failure on our part.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What happens to my projects if I cancel?
                </h3>
                <p>
                  Your projects remain accessible in read-only mode for 30 days
                  after cancellation. You can export them during this period.
                  After 30 days, projects may be deleted. The desktop runner and
                  Python library remain free and open source, so exported
                  projects can continue to run locally.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Do you offer refunds if I get banned from a game?
                </h3>
                <p>
                  <strong>No.</strong> Account bans from third-party services
                  are not grounds for refunds. You acknowledge and accept all
                  risks associated with automation when you use our service. We
                  explicitly disclaim any warranty that our service will avoid
                  detection or comply with third-party terms.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Is there an enterprise plan?
                </h3>
                <p>
                  Yes, we offer enterprise plans with custom features, dedicated
                  support, SLAs, and volume licensing. Contact us at
                  jspinak@alum.mit.edu for enterprise inquiries.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Do you offer student or educational discounts?
                </h3>
                <p>
                  We may offer discounts for educational institutions and
                  verified students. Contact us with details about your
                  educational use case.
                </p>
              </div>
            </div>
          </section>

          {/* Best Practices */}
          <section>
            <h2 className="text-3xl font-bold mb-6 text-text-primary">
              Best Practices
            </h2>

            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How can I minimize the risk of bans?
                </h3>
                <p className="mb-2">
                  <strong>
                    While we cannot guarantee you won&apos;t be banned, these
                    practices may reduce risk:
                  </strong>
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Only automate single-player games</strong> without
                    online components
                  </li>
                  <li>
                    <strong>Read and comply with game ToS</strong> before
                    automating
                  </li>
                  <li>
                    <strong>Use reasonable timing</strong> - don&apos;t make
                    automation inhumanly fast
                  </li>
                  <li>
                    <strong>Add randomization</strong> to behavior patterns
                  </li>
                  <li>
                    <strong>Don&apos;t run automation 24/7</strong> - take
                    breaks like a human would
                  </li>
                  <li>
                    <strong>Avoid competitive modes</strong> entirely
                  </li>
                  <li>
                    <strong>
                      Don&apos;t automate games with aggressive anti-cheat
                    </strong>
                  </li>
                  <li>
                    <strong>Use separate accounts</strong> for testing if you
                    must test in risky scenarios
                  </li>
                </ul>
                <p className="mt-2 font-semibold">
                  Remember: The safest approach is to not automate games that
                  prohibit it.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What should I NOT automate?
                </h3>
                <p className="mb-2">
                  <strong>Avoid automating:</strong>
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>Multiplayer or competitive games</li>
                  <li>Any application that explicitly prohibits automation</li>
                  <li>Banking or financial applications (security risk)</li>
                  <li>Social media for spam or manipulation</li>
                  <li>E-commerce for scalping or price manipulation</li>
                  <li>Voting systems or engagement metrics</li>
                  <li>
                    Applications containing sensitive personal data of others
                  </li>
                  <li>
                    Any activity that provides unfair competitive advantage
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Should I tell others I&apos;m using automation?
                </h3>
                <p>
                  <strong>It depends on the context:</strong>
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>In competitive environments:</strong> You should not
                    be using automation at all
                  </li>
                  <li>
                    <strong>In single-player games:</strong> It&apos;s your
                    choice, though some communities frown upon it
                  </li>
                  <li>
                    <strong>For research or testing:</strong> Be transparent
                    about your methods
                  </li>
                  <li>
                    <strong>In professional settings:</strong> Document
                    automation for QA and testing
                  </li>
                </ul>
                <p className="mt-2">
                  Never misrepresent automated achievements as manual play in
                  competitive or social contexts.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How do I test automation safely?
                </h3>
                <p className="mb-2">
                  <strong>Safe testing practices:</strong>
                </p>
                <ol className="list-decimal pl-6 space-y-2">
                  <li>
                    <strong>Start with your own applications</strong> or test
                    environments
                  </li>
                  <li>
                    <strong>Use sandbox/test accounts</strong> when possible
                  </li>
                  <li>
                    <strong>Test offline</strong> before going online
                  </li>
                  <li>
                    <strong>Start with simple, low-risk tasks</strong> to verify
                    behavior
                  </li>
                  <li>
                    <strong>Monitor automation closely</strong> during initial
                    runs
                  </li>
                  <li>
                    <strong>Have kill switches</strong> to stop automation
                    quickly
                  </li>
                  <li>
                    <strong>Document what you&apos;re testing</strong> and why
                  </li>
                </ol>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  What are good use cases for Qontinui?
                </h3>
                <p className="mb-2">
                  <strong>Excellent use cases include:</strong>
                </p>
                <ul className="list-disc pl-6 space-y-2">
                  <li>
                    <strong>Software QA:</strong> Automated UI testing,
                    regression testing
                  </li>
                  <li>
                    <strong>Personal productivity:</strong> Automating
                    repetitive desktop tasks
                  </li>
                  <li>
                    <strong>Data entry:</strong> Migrating data between systems
                    (where authorized)
                  </li>
                  <li>
                    <strong>Game development:</strong> Testing your own games
                  </li>
                  <li>
                    <strong>Research:</strong> UI/UX research, human-computer
                    interaction studies
                  </li>
                  <li>
                    <strong>Education:</strong> Teaching automation and AI
                    concepts
                  </li>
                  <li>
                    <strong>Accessibility:</strong> Creating aids for users with
                    disabilities (with permission)
                  </li>
                  <li>
                    <strong>Single-player gaming:</strong> In games that allow
                    it
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  How can I stay updated on Terms of Service changes?
                </h3>
                <p className="mb-2">
                  <strong>For games and services you automate:</strong>
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Check their official website or forums periodically</li>
                  <li>Subscribe to game developer newsletters</li>
                  <li>Join community Discord servers or subreddits</li>
                  <li>Set calendar reminders to review ToS quarterly</li>
                  <li>Use ToS change tracking services if available</li>
                </ul>
                <p className="mt-2">
                  <strong>For Qontinui:</strong> We&apos;ll notify you of
                  material changes to our Terms or Acceptable Use Policy by
                  email and on our website.
                </p>
              </div>

              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Should I use a VPN or proxy with automation?
                </h3>
                <p>
                  <strong>We neither recommend nor discourage VPN use.</strong>{" "}
                  However, be aware:
                </p>
                <ul className="list-disc pl-6 space-y-1 mt-2">
                  <li>VPNs don&apos;t make automation undetectable</li>
                  <li>Some games ban VPN usage</li>
                  <li>Suspicious IP changes may trigger additional scrutiny</li>
                  <li>VPNs won&apos;t protect you from behavioral detection</li>
                  <li>Using VPNs to evade bans typically violates ToS</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Still Have Questions? */}
          <section className="bg-surface-canvas border border-border-subtle rounded-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-text-primary">
              Still Have Questions?
            </h2>
            <p className="mb-4">
              We&apos;re here to help you use Qontinui responsibly and
              effectively.
            </p>
            <div className="space-y-2">
              <p>
                <strong>General Support:</strong> Visit our documentation at
                qontinui.com/docs
              </p>
              <p>
                <strong>Legal/Compliance Questions:</strong> Email
                jspinak@alum.mit.edu
              </p>
              <p>
                <strong>Community:</strong> Join our Discord or forums for user
                discussions
              </p>
            </div>
            <p className="mt-4 font-semibold">
              When in doubt about whether a use case is appropriate, please
              contact us BEFORE proceeding.
            </p>
          </section>

          {/* Important Disclaimers */}
          <section className="bg-yellow-50 border border-yellow-300 rounded-lg p-6">
            <h2 className="text-2xl font-semibold mb-4 text-text-primary">
              Important Disclaimers
            </h2>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                <strong>You Are Responsible:</strong> You are solely responsible
                for how you use Qontinui and for ensuring your use complies with
                all applicable laws and third-party terms of service.
              </li>
              <li>
                <strong>No Guarantees:</strong> We provide no warranty that
                automation will work with any specific application, avoid
                detection, or comply with third-party ToS.
              </li>
              <li>
                <strong>No Circumvention Tools:</strong> Qontinui does not
                include anti-cheat bypass tools or security circumvention
                methods.
              </li>
              <li>
                <strong>Ban Risk:</strong> Using automation in games or
                applications that prohibit it may result in account bans. We are
                not responsible for bans or other third-party actions.
              </li>
              <li>
                <strong>Legal Risk:</strong> Some uses of automation may violate
                laws like the CFAA or DMCA. Consult a lawyer if you&apos;re
                unsure.
              </li>
              <li>
                <strong>Read the Full Terms:</strong> This FAQ is for
                convenience only. For complete legal terms, see our{" "}
                <Link
                  href="/terms"
                  className="text-blue-600 hover:underline font-semibold"
                >
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link
                  href="/acceptable-use"
                  className="text-blue-600 hover:underline font-semibold"
                >
                  Acceptable Use Policy
                </Link>
                .
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
