import Link from "next/link";
import { Sparkles } from "lucide-react";
import { LEGAL, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION, PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/**
 * Shared frame for /terms and /privacy: brand mark, title, effective date, a table of contents and
 * numbered sections. Public (no sign-in) and rendered without the app shell (app-chrome.tsx).
 */
export function LegalDocument({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">{LEGAL.product}</span>
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href={TERMS_PATH} className="hover:text-foreground">
              Terms
            </Link>
            <Link href={PRIVACY_PATH} className="hover:text-foreground">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective {LEGAL_EFFECTIVE_DATE} · Version {LEGAL_VERSION}
        </p>
        <div className="mt-6 space-y-3 text-[15px] leading-7 text-foreground/90">{intro}</div>

        <nav aria-label="Contents" className="mt-8 rounded-lg border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contents</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-6">
              <h2 className="text-lg font-semibold tracking-tight">
                {i + 1}. {s.title}
              </h2>
              <div className="legal-body mt-3 space-y-3 text-[15px] leading-7 text-foreground/90 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5 [&_strong]:font-semibold">
                {s.body}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-14 border-t border-border pt-6 text-sm text-muted-foreground">
          Questions? Email{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="underline underline-offset-4">
            {LEGAL.contactEmail}
          </a>
          . {LEGAL.product} is operated by {LEGAL.company}.
        </footer>
      </main>
    </div>
  );
}
