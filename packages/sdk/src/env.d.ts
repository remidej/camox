/// <reference types="vite-plus/client" />
/// <reference types="vite-plus/types/importMeta.d.ts" />

declare module "virtual:camox-studio-css" {
  const url: string;
  export default url;
}

declare module "virtual:camox-overlay-css" {
  const css: string;
  export default css;
}

declare module "virtual:camox/server" {
  export function handleCamoxRequest(request: Request): Promise<Response | null>;
  /** Whether a request reads what every visitor sees, so the edge may answer it. */
  export function isPublicRequest(request: Request): boolean;
  /** Where the Live cache key is read from, and the build public renders are kept under. */
  export const publicCacheSource: { apiUrl: string; projectUuid: string; build: string };
  /** Where the runtime is mounted, without a trailing slash; empty at the root. */
  export const runtimeBasePath: string;
  /** What Vite injects into HTML in dev; `null` in builds. */
  export const devHtml: { head: string; body: string } | null;
  /** The website's Definition Set, as `definitions.sync` receives it. */
  export function readDefinitionSet(): Promise<unknown>;
}

/** The part of the Workers runtime's module the Worker uses. */
declare module "cloudflare:workers" {
  export abstract class WorkerEntrypoint {
    constructor(ctx: unknown, env: unknown);
  }
}

declare module "virtual:camox/page-client-url" {
  const url: string;
  export default url;
}

declare module "virtual:camox/studio-client-url" {
  const url: string;
  export default url;
}

declare const __CAMOX_AUTHENTICATION_URL__: string;
declare const __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__: boolean;
/** This build of the website, which public renders are cached under. */
declare const __CAMOX_BUILD_ID__: string;

// Temporal API types (Stage 3, available in modern browsers)
declare namespace Temporal {
  class Instant {
    static fromEpochMilliseconds(epochMs: number): Instant;
    since(other: Instant): Duration;
  }
  class Duration {
    total(unit: string): number;
  }
  namespace Now {
    function instant(): Instant;
  }
}
