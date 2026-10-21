import Link from "next/link"

import { SiteFooter } from "@/components/page-shell"

export interface PolicySection {
  title: string
  paragraphs?: readonly string[]
  items?: readonly string[]
}

/** Policy page typeset with the documented typography recipes. */
export function PolicyPage({
  title,
  lead,
  sections,
}: {
  title: string
  lead: string
  sections: readonly PolicySection[]
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <article className="flex flex-col gap-6">
          <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
            VisitProof
          </Link>
          <h1 className="scroll-m-20 text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="text-xl text-muted-foreground">{lead}</p>
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-3">
              <h2 className="scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight">
                {section.title}
              </h2>
              {section.paragraphs?.map((text) => (
                <p key={text} className="leading-7">
                  {text}
                </p>
              ))}
              {section.items ? (
                <ul className="ml-6 list-disc [&>li]:mt-2">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </article>
      </main>
      <SiteFooter />
    </div>
  )
}
