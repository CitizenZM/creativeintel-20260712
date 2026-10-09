import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, type LegalSection } from "@/components/legal/legal-document";
import { LEGAL, TERMS_PATH } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · CreativeIntel OS" };

const { company, product, site, contactEmail, minimumAge } = LEGAL;

/** Who processes data for us, and why. Keep in step with the providers configured in production. */
const SUBPROCESSORS: { name: string; purpose: string; where: string }[] = [
  { name: "Clerk", purpose: "Account sign-up, sign-in, email verification and session management", where: "USA" },
  { name: "Vercel", purpose: "Application hosting, serverless compute and file storage (Vercel Blob)", where: "USA / global edge" },
  { name: "Supabase", purpose: "Primary database", where: "USA" },
  { name: "Cloudflare", purpose: "DNS, network security and traffic routing", where: "Global" },
  { name: "OpenRouter", purpose: "Routing AI requests to text, vision, image and video models (e.g. DeepSeek, Google, ByteDance Seedream)", where: "USA; model hosts worldwide" },
  { name: "Google (Gemini / Veo, YouTube Data API)", purpose: "AI analysis and generation; public video metadata for research", where: "USA / global" },
  { name: "OpenAI", purpose: "AI image generation and audio transcription", where: "USA" },
  { name: "fal.ai", purpose: "AI video generation", where: "USA" },
  { name: "Zhipu AI (GLM)", purpose: "AI text, image and video generation when selected", where: "China" },
  { name: "Meta", purpose: "Public ad-library research and, if you connect it, ad performance data", where: "USA / global" },
];

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Who we are and what this covers",
    body: (
      <p>
        {product} at {site} is operated by {company}{" "}(&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what
        personal data we collect when you use the Service, how we use and share it, and the choices and rights you have.
        It forms part of our <Link href={TERMS_PATH} className="underline underline-offset-4">Terms of Service</Link>. For
        content you upload about your own customers or other people, you are the controller and we process it on your
        behalf to provide the Service.
      </p>
    ),
  },
  {
    id: "collect",
    title: "Information we collect",
    body: (
      <ul>
        <li><strong>Account data</strong> — your email address, optional name, verification status, and the date you accepted our Terms and this policy. Passwords are handled by our authentication provider (Clerk) and are never visible to us.</li>
        <li><strong>Workspace content</strong> — briefs, product and brand information, URLs, uploaded files and assets, prompts, and everything generated for you (plans, scripts, storyboards, images, videos, reports) plus their version history.</li>
        <li><strong>Usage and billing data</strong> — actions you take, AI models used, tokens, images and video seconds consumed, and estimated cost, used to meter your allowance.</li>
        <li><strong>Technical data</strong> — IP address, browser and device information, timestamps and logs generated when you use the Service, for security, debugging and abuse prevention.</li>
        <li><strong>Connected accounts</strong> — if you connect a third-party platform (for example an ad account), the data you authorize us to read from it.</li>
        <li><strong>Communications</strong> — messages you send us.</li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "How we use information",
    body: (
      <>
        <ul>
          <li>to create and secure your account and keep your workspace private to you;</li>
          <li>to provide the features you request, including sending your content to AI providers to analyze it and generate outputs;</li>
          <li>to meter usage, enforce allowances and limits, and prevent fraud, abuse and violations of our Terms;</li>
          <li>to maintain, debug and improve the reliability and quality of the Service;</li>
          <li>to communicate with you about your account, security and changes to our terms;</li>
          <li>to comply with law and enforce our rights.</li>
        </ul>
        <p>
          We do not sell your personal data, we do not share it for cross-context behavioural advertising, and we do not
          use your workspace content to train our own or third-party foundation models.
        </p>
      </>
    ),
  },
  {
    id: "legal-bases",
    title: "Legal bases (EEA / UK users)",
    body: (
      <p>
        We process personal data to perform our contract with you (providing the Service), for our legitimate interests
        (security, abuse prevention, improving the Service, business communications), to comply with legal obligations,
        and with your consent where required. You may withdraw consent at any time without affecting earlier processing.
      </p>
    ),
  },
  {
    id: "sharing",
    title: "How we share information",
    body: (
      <>
        <p>We share personal data only with:</p>
        <ul>
          <li><strong>Service providers (subprocessors)</strong> who process it for us under contractual obligations — listed below;</li>
          <li><strong>Platforms you connect</strong>, as needed to perform the actions you request;</li>
          <li><strong>Authorities or other parties</strong> when required by law, or to protect the rights, safety and security of our users, the public or {company};</li>
          <li><strong>A successor</strong> in a merger, acquisition or sale of assets, subject to this policy.</li>
        </ul>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Purpose</th>
                <th className="px-3 py-2 font-medium">Location</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.purpose}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{s.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          AI providers receive only the content needed for the request you make. Their handling of that content is also
          governed by their own terms and policies.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <p>
        We are based in the United States and our providers operate in several countries, including the United States and,
        for certain optional AI models, China. Where we transfer personal data from the EEA, UK or Switzerland, we rely on
        appropriate safeguards such as the European Commission&rsquo;s Standard Contractual Clauses or the provider&rsquo;s
        equivalent commitments. Avoid uploading sensitive personal data you do not want processed outside your country.
      </p>
    ),
  },
  {
    id: "retention",
    title: "Retention",
    body: (
      <ul>
        <li>Account data and workspace content are kept while your account is active so you can access your history.</li>
        <li>When you ask us to delete your account, we delete or anonymize your workspace content within 30 days, except where we must keep it to meet legal obligations, resolve disputes or enforce our agreements.</li>
        <li>Backups are overwritten on a rolling basis, and security and usage logs are kept for up to 12 months.</li>
        <li>Usage and cost records may be kept in aggregated or de-identified form.</li>
      </ul>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We protect data with encryption in transit (HTTPS), access controls that keep each account&rsquo;s workspace
        separate, encrypted storage of provider credentials, and least-privilege access for our staff. No system is
        perfectly secure; please use a strong, unique password and tell us immediately at {contactEmail} if you suspect
        unauthorized access.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights and choices",
    body: (
      <>
        <p>
          Depending on where you live (including the EEA, UK and US states such as California), you may have the right to
          access, correct, delete or receive a copy of your personal data, to object to or restrict certain processing, and
          to not be discriminated against for exercising these rights. You can:
        </p>
        <ul>
          <li>update your email, name and password from the account menu;</li>
          <li>download your project history from each project&rsquo;s History page;</li>
          <li>request access, deletion or other rights by emailing {contactEmail} from the address on your account.</li>
        </ul>
        <p>
          We will verify your request and respond within the time required by law (generally 30 days in the EEA/UK and 45
          days in California). You may also complain to your local data-protection authority.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We use only cookies and similar storage that are necessary to run the Service — to keep you signed in, protect
        against attacks, and remember preferences such as your active workspace and theme. We do not use advertising or
        cross-site tracking cookies.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        The Service is not directed to anyone under {minimumAge}, and we do not knowingly collect personal data from
        them. If you believe a child has given us personal data, contact us and we will delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy. The version and effective date are shown at the top, and we will notify you of
        material changes by email or in the app before they take effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {company} · {contactEmail}. For privacy requests, include the email address on your account so we can verify
        you.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={
        <p>
          Your workspace is private to your account. We use your data to run {product}, keep it secure and meter usage
          — we don&rsquo;t sell it, and we don&rsquo;t train AI models on it.
        </p>
      }
      sections={sections}
    />
  );
}
