import { escapeAttribute, serializeJsonForHtml } from "../../lib/html";
import type { PageStructure } from "../routes/pageRuntime";

/**
 * The project's analytics providers, a Project Setting. Each provider is null when it isn't set up.
 */
export type AnalyticsProviders = PageStructure["project"]["analytics"];

type Provider = keyof AnalyticsProviders;

/** `providers`, when at least one is set up. */
export function configuredProviders(
  providers: AnalyticsProviders | undefined,
): AnalyticsProviders | undefined {
  return providers?.ga4 || providers?.posthog ? providers : undefined;
}

/**
 * PostHog's standard snippet: it defines a `posthog` global that queues calls, and loads the SDK
 * from the host passed to `init` without blocking the page.
 */
const POSTHOG_SNIPPET = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;

/** The scripts that load each provider, with automatic page views off. */
const providerScripts: {
  [P in Provider]: (settings: NonNullable<AnalyticsProviders[P]>) => string;
} = {
  ga4: ({ measurementId }) => {
    const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    return `<script async src="${escapeAttribute(src)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config",${serializeJsonForHtml(measurementId)},{send_page_view:false});</script>`;
  },
  posthog: ({ projectApiKey, region }) => {
    const config = {
      api_host: `https://${region}.i.posthog.com`,
      // PostHog's recommended defaults as of this snippet, as its own install instructions pin.
      defaults: "2026-05-30",
      capture_pageview: false,
      // Turning automatic page views off would turn page leaves off too, which PostHog's bounce
      // rate and session duration rely on.
      capture_pageleave: true,
    };
    return `<script>${POSTHOG_SNIPPET}posthog.init(${serializeJsonForHtml(projectApiKey)},${serializeJsonForHtml(config)});</script>`;
  },
};

/**
 * The providers' scripts, loaded without blocking the page. They send no page view of their own:
 * the page client does, once each page's title is in place.
 */
export function renderAnalyticsScripts(providers: AnalyticsProviders | undefined): string {
  if (!providers) return "";
  return (
    (providers.ga4 ? providerScripts.ga4(providers.ga4) : "") +
    (providers.posthog ? providerScripts.posthog(providers.posthog) : "")
  );
}

type AnalyticsWindow = Pick<Window, "location" | "document"> & {
  gtag?: (...args: unknown[]) => void;
  posthog?: { capture: (event: string, properties: Record<string, unknown>) => void };
};

/** The page a visitor is on, as each provider is told about it. */
interface PageView {
  url: string;
  path: string;
  title: string;
}

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
  posthog: ({ url, path, title }, target) =>
    target.posthog?.capture("$pageview", {
      $current_url: url,
      $pathname: path,
      title,
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
