import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";

/**
 * Where a navigation goes, naming the draft the way the URL does (ADR 0011). A target on this
 * site keeps the current URL's draft, unless it names one itself or `draft` switches to another
 * draft (`null` for Live). Other sites' URLs are left alone. The result keeps the target's form:
 * a path stays a path.
 */
export function withDraftParam(to: string, currentHref: string, draft?: string | null): string {
  const current = new URL(currentHref);
  const target = new URL(to, current);
  if (target.origin !== current.origin) return to;
  if (draft === undefined && target.searchParams.has(DRAFT_SEARCH_PARAM)) return to;

  const next = draft === undefined ? current.searchParams.get(DRAFT_SEARCH_PARAM) : draft;
  if (next) target.searchParams.set(DRAFT_SEARCH_PARAM, next);
  else target.searchParams.delete(DRAFT_SEARCH_PARAM);
  if (target.href === new URL(to, current).href) return to;
  return /^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//")
    ? target.href
    : `${target.pathname}${target.search}${target.hash}`;
}
