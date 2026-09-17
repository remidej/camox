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
declare const __CAMOX_ENABLE_COMMENTS__: boolean;

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
