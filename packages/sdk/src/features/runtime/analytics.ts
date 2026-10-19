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

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * The providers' scripts, loaded without blocking the page. They send no page view of their own:
 * the page client does, once each page's title is in place.
 */
export function renderAnalyticsScripts(providers: AnalyticsProviders | undefined): string {
  const ga4 = providers?.ga4;
  if (!ga4) return "";
  const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4.measurementId)}`;
  return `<script async src="${escapeHtmlAttribute(src)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${scriptLiteral(ga4.measurementId)},{send_page_view:false});</script>`;
}

type AnalyticsWindow = Pick<Window, "location" | "document"> & {
  gtag?: (...args: unknown[]) => void;
};

/** Sends a page view of the page `target` shows to every provider the server loaded. */
export function sendPageView(providers: AnalyticsProviders, target: AnalyticsWindow) {
  if (providers.ga4) {
    target.gtag?.("event", "page_view", {
      page_location: target.location.href,
      page_path: target.location.pathname,
      page_title: target.document.title,
    });
  }
}
