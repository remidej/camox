import { escapeAttribute, serializeJsonForHtml } from "../../lib/html";
import type { PageStructure } from "../routes/pageRuntime";

/**
 * The project's analytics providers, a Project Setting. Each provider is null when it isn't set up.
 */
export type AnalyticsProviders = PageStructure["project"]["analytics"];

/** `providers`, when at least one is set up. */
export function configuredProviders(
  providers: AnalyticsProviders | undefined,
): AnalyticsProviders | undefined {
  return providers?.ga4 ? providers : undefined;
}

/**
 * The providers' scripts, loaded without blocking the page. They send no page view of their own:
 * the page client does, once each page's title is in place.
 */
export function renderAnalyticsScripts(providers: AnalyticsProviders | undefined): string {
  const ga4 = providers?.ga4;
  if (!ga4) return "";
  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4.measurementId)}`;
  return `<script async src="${escapeAttribute(src)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${serializeJsonForHtml(ga4.measurementId)},{send_page_view:false});</script>`;
}

type AnalyticsWindow = Pick<Window, "location" | "document"> & {
  gtag?: (...args: unknown[]) => void;
};

/** The page a visitor is on, as each provider is told about it. */
interface PageView {
  url: string;
  path: string;
  title: string;
}

type Provider = keyof AnalyticsProviders;

/** How each provider receives a page view, through the global its script defines. */
const pageViewSenders: {
  [P in Provider]: (pageView: PageView, target: AnalyticsWindow) => void;
} = {
  ga4: ({ url, path, title }, target) =>
    target.gtag?.("event", "page_view", {
      page_location: url,
      page_path: path,
      page_title: title,
    }),
};

/** Sends a page view of the page `target` shows to every provider the server loaded. */
export function sendPageView(providers: AnalyticsProviders, target: AnalyticsWindow) {
  const pageView: PageView = {
    url: target.location.href,
    path: target.location.pathname,
    title: target.document.title,
  };
  for (const provider of Object.keys(pageViewSenders) as Provider[]) {
    if (providers[provider]) pageViewSenders[provider](pageView, target);
  }
}
