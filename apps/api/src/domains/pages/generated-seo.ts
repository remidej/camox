import { Effect } from "effect";

import type { Database } from "../../db";
import type { ReadScope } from "../drafts/scope";
import { readValues } from "../generated-values/service";
import type { pages } from "./schema";

// A page's meta title and description are one group (ADR 0012): all generated or all manual.
// Manual values are content; `null` in both columns means the generated values apply.

type PageRow = typeof pages.$inferSelect;

/** A page as readers see it: the SEO in effect, and whether it's generated. */
export type PageView<P extends PageRow = PageRow> = P & { aiSeo: boolean };

export const seoKey = (pageId: string) =>
  ({ entity: "page", entityId: pageId, type: "seo" }) as const;

/** Whether a page's SEO group is generated. */
export const seoGenerated = (page: Pick<PageRow, "metaTitle" | "metaDescription">) =>
  page.metaTitle === null && page.metaDescription === null;

/**
 * Pages with the SEO in effect for the scope: manual values, or generated ones, null while
 * nothing was generated.
 */
export const withSeo = Effect.fn("pages.withSeo")(function* <P extends PageRow>(
  db: Database,
  scope: ReadScope,
  rows: readonly P[],
) {
  const generated = yield* readValues(
    db,
    scope,
    "page",
    "seo",
    rows.filter(seoGenerated).map((row) => row.id),
  );
  return rows.map((row): PageView<P> => {
    if (!seoGenerated(row)) return { ...row, aiSeo: false };
    const value = generated.get(row.id)?.value;
    return {
      ...row,
      metaTitle: value?.metaTitle ?? null,
      metaDescription: value?.metaDescription ?? null,
      aiSeo: true,
    };
  });
});

/** The generated SEO of pages as the scope reads it, with whether a job is pending. */
export const generatedSeoOf = (db: Database, scope: ReadScope, pageIds: string[]) =>
  readValues(db, scope, "page", "seo", pageIds);
