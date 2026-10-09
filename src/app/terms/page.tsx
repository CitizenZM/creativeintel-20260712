import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { LEGAL, PRIVACY_PATH } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service · CreativeIntel OS" };

const { company, product, site, contactEmail, governingLaw, venue, minimumAge } = LEGAL;

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement to these Terms",
    body: (
      <>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you and {company} (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;) governing your access to and use of {product} at {site}, including its websites, APIs, AI
          agents, generated outputs and related services (the &ldquo;Service&rdquo;).
        </p>
        <p>
          By creating an account, checking the consent box at sign-up, or using the Service, you confirm that you have
          read and accept these Terms and our <Link href={PRIVACY_PATH} className="underline underline-offset-4">Privacy Policy</Link>.
          If you use the Service on behalf of a company or client, you represent that you are authorized to bind that
          organization, and &ldquo;you&rdquo; includes it. If you do not agree, do not use the Service.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility and accounts",
    body: (
      <ul>
        <li>You must be at least {minimumAge} years old and able to form a binding contract. The Service is for business and professional use, not for consumers acting for personal, family or household purposes.</li>
        <li>You must give accurate registration information, verify your email address and keep it current.</li>
        <li>You are responsible for keeping your credentials confidential and for everything that happens under your account. Tell us immediately at {contactEmail} if you suspect unauthorized access.</li>
        <li>One person per account. You may not share an account, sell or transfer it, or create multiple accounts — including to obtain additional free usage allowances or to evade a suspension.</li>
        <li>We may refuse registration, or require additional verification, at our discretion.</li>
      </ul>
    ),
  },
  {
    id: "service",
    title: "The Service",
    body: (
      <>
        <p>
          {product} helps marketing teams research brands, competitors and ads; plan campaigns; and generate scripts,
          storyboards, images, videos and reports using artificial-intelligence models, some of which are provided by
          third parties. Each account works in its own private workspace.
        </p>
        <p>
          The Service is evolving. We may add, change, limit or remove features, models, engines or integrations at any
          time, and some features may be labelled beta or experimental and provided with less reliability. We do not
          guarantee that any particular model, provider or output quality will remain available.
        </p>
      </>
    ),
  },
  {
    id: "allowances",
    title: "Usage allowances, fees and limits",
    body: (
      <ul>
        <li>Paid AI generation (for example image and video models) is metered. Accounts receive a monthly usage allowance set by us, which may be zero; usage beyond the allowance is refused unless we agree otherwise in writing.</li>
        <li>Allowances, quotas, rate limits and the cost of each action are estimates and may change. Unused allowance does not roll over and has no cash value.</li>
        <li>If we introduce paid plans, prices and payment terms will be shown before you are charged, and those terms will form part of these Terms.</li>
        <li>You may not circumvent metering, allowances, rate limits or access controls, including through automation, multiple accounts or manipulation of requests.</li>
      </ul>
    ),
  },
  {
    id: "your-content",
    title: "Your content",
    body: (
      <>
        <p>
          &ldquo;Your Content&rdquo; means the briefs, product information, brand assets, files, URLs, prompts and other
          material you submit, and the outputs generated for you. As between you and us, you retain your rights in Your
          Content.
        </p>
        <p>
          You grant us a worldwide, non-exclusive, royalty-free licence to host, copy, process, transmit, display and
          modify Your Content solely to operate, secure, support and improve the Service for you — including sending it
          to the AI and infrastructure providers listed in our Privacy Policy to perform the actions you request. We do not
          sell Your Content and we do not use it to train our own or third-party foundation models.
        </p>
        <p>You represent and warrant that:</p>
        <ul>
          <li>you own or have all rights, licences and consents needed for Your Content (including logos, trademarks, product images, music, voices and likenesses) and for us to process it as described;</li>
          <li>Your Content and your use of outputs do not infringe anyone&rsquo;s intellectual-property, publicity, privacy or other rights and do not violate any law or platform policy;</li>
          <li>you will not upload personal data of others unless you have a lawful basis and have given any required notices.</li>
        </ul>
      </>
    ),
  },
  {
    id: "ai-outputs",
    title: "AI-generated outputs",
    body: (
      <>
        <p>AI output is probabilistic. You acknowledge and agree that:</p>
        <ul>
          <li>outputs may be inaccurate, incomplete, offensive, similar to content generated for others, or similar to existing works, and are provided for your review — not as professional, legal or advertising-compliance advice;</li>
          <li><strong>you are solely responsible</strong> for reviewing, editing and approving every output before you use or publish it, including the accuracy of product claims, prices, offers, comparisons, testimonials and disclosures, and compliance with advertising law and the policies of platforms such as Meta, TikTok, Google, YouTube and Amazon;</li>
          <li>competitor and market research summarizes publicly available material; you are responsible for how you use it and for respecting third parties&rsquo; rights;</li>
          <li>we do not guarantee that outputs are eligible for copyright or other protection, are unique to you, or will achieve any business result (views, sales, ROAS or otherwise).</li>
        </ul>
        <p>Subject to these Terms and the terms of the underlying model providers, you may use outputs generated for you for your lawful business purposes.</p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You will not, and will not allow anyone else to, use the Service to:</p>
        <ul>
          <li>break any law or regulation, or infringe or misappropriate anyone&rsquo;s rights;</li>
          <li>create deceptive, fraudulent or misleading advertising, fake reviews or testimonials, or content that impersonates a real person, brand or organization;</li>
          <li>generate deepfakes or depict a real, identifiable person without their consent, or create sexual content involving minors, non-consensual intimate imagery, or content that promotes violence, terrorism, hate or self-harm;</li>
          <li>generate malware, spam, phishing or other harmful content, or harass, threaten or defame anyone;</li>
          <li>probe, scan, reverse-engineer, decompile, scrape or bulk-extract the Service, its models, prompts or other users&rsquo; data, or bypass any authentication, access control, allowance or rate limit;</li>
          <li>interfere with or overload the Service, or access it by automated means except through interfaces we provide;</li>
          <li>resell, sublicense or offer the Service to third parties as a standalone product without our written agreement;</li>
          <li>use the Service or outputs to build a competing product or to train AI models;</li>
          <li>violate the usage policies of the AI providers that power the Service.</li>
        </ul>
        <p>We may investigate suspected violations, remove content and cooperate with law enforcement.</p>
      </>
    ),
  },
  {
    id: "our-ip",
    title: "Our intellectual property",
    body: (
      <p>
        The Service — including its software, agents, prompts, workflows, templates, playbooks, designs and the{" "}
        {product} name and marks — is owned by {company} and its licensors and is protected by law. We grant you a limited,
        revocable, non-exclusive, non-transferable right to use the Service under these Terms. All rights not expressly
        granted are reserved. If you send us feedback or suggestions, we may use them without obligation to you.
      </p>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <p>
        The Service relies on third-party providers (for example authentication, hosting, databases, storage and AI
        models) and may link to or import from third-party platforms. Their services are governed by their own terms, and
        we are not responsible for them. Connecting a third-party account authorizes us to access it as needed to provide
        the features you use.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and termination",
    body: (
      <>
        <p>
          You may stop using the Service at any time and ask us to delete your account. We may suspend, limit or
          terminate your access — immediately and without notice where reasonably necessary — if you breach these Terms,
          create risk or legal exposure for us or others, abuse allowances, fail verification, or if we discontinue the
          Service.
        </p>
        <p>
          On termination your right to use the Service ends. We may delete Your Content after termination as described in
          the Privacy Policy, so export anything you need first (project history is downloadable from each project).
          Sections that by their nature should survive — including ownership, disclaimers, limitation of liability,
          indemnity and dispute terms — survive termination.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p className="uppercase text-[13px] leading-6 tracking-wide">
        The Service and all outputs are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent
        permitted by law, {company} disclaims all warranties, express or implied, including merchantability, fitness for a
        particular purpose, title, non-infringement, accuracy and uninterrupted or error-free operation. We do not warrant
        that the Service will be secure, that data will not be lost, or that outputs will be accurate, lawful or suitable for
        any purpose.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p className="uppercase text-[13px] leading-6 tracking-wide">
          To the fullest extent permitted by law, neither {company} nor its affiliates, officers, employees, agents or
          suppliers will be liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or
          for any loss of profits, revenue, goodwill, data or advertising spend, arising out of or relating to the Service or
          these Terms, even if advised of the possibility.
        </p>
        <p className="uppercase text-[13px] leading-6 tracking-wide">
          Our total liability for all claims relating to the Service or these Terms is limited to the greater of (a) the
          amounts you paid us for the Service in the twelve months before the event giving rise to the claim, or (b) one
          hundred US dollars (US$100).
        </p>
        <p>Some jurisdictions do not allow certain limitations, so some of the above may not apply to you.</p>
      </>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    body: (
      <p>
        You will defend, indemnify and hold harmless {company} and its affiliates, officers, employees and agents from any
        claims, damages, losses, liabilities, costs and expenses (including reasonable attorneys&rsquo; fees) arising from
        Your Content, your use of the Service or outputs (including any advertisement you publish), your breach of these
        Terms, or your violation of any law or third-party right.
      </p>
    ),
  },
  {
    id: "disputes",
    title: "Governing law and disputes",
    body: (
      <p>
        These Terms are governed by the laws of {governingLaw}, without regard to conflict-of-laws rules. Any dispute
        arising from or relating to these Terms or the Service will be brought exclusively in {venue}, and you and we
        consent to their jurisdiction. Before filing a claim, each party agrees to try to resolve the dispute informally by
        contacting the other for at least 30 days. Claims must be brought individually, not as a plaintiff or class member
        in any class or representative proceeding, to the extent permitted by law.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <p>
        We may update these Terms. The version and effective date are shown at the top. For material changes we will give
        reasonable notice — for example by email or in the app — and may ask you to accept the new version. Continued use
        after the effective date means you accept the updated Terms.
      </p>
    ),
  },
  {
    id: "general",
    title: "General",
    body: (
      <ul>
        <li>These Terms and the Privacy Policy are the entire agreement between you and us about the Service and supersede prior understandings.</li>
        <li>If any provision is unenforceable, it will be limited to the minimum extent necessary and the rest remains in effect. Our failure to enforce a provision is not a waiver.</li>
        <li>You may not assign these Terms without our consent; we may assign them in connection with a merger, acquisition or sale of assets.</li>
        <li>We are not liable for delays or failures caused by events beyond our reasonable control.</li>
        <li>Notices to us must be sent to {contactEmail}. We may send notices to the email address on your account.</li>
      </ul>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      intro={
        <p>
          Please read these Terms carefully. They limit our liability, make you responsible for reviewing AI-generated
          output before you use it, and set out how disputes are resolved.
        </p>
      }
      sections={sections}
    />
  );
}
