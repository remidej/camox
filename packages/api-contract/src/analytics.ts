import { z } from "zod";

/**
 * A GA4 measurement ID: `G-` followed by uppercase letters and digits. Shared so the dashboard
 * checks an ID by the API's own rule before saving it.
 */
export const ga4MeasurementIdSchema = /* @__PURE__ */ z
  .string()
  .regex(/^G-[A-Z0-9]+$/, "Not a GA4 measurement ID");

/**
 * A PostHog project API key: `phc_` followed by letters and digits. The prefix tells it apart from
 * a personal API key, which is secret and must never reach a public page.
 */
export const posthogProjectApiKeySchema = /* @__PURE__ */ z
  .string()
  .regex(/^phc_[A-Za-z0-9]+$/, "Not a PostHog project API key");

/** The PostHog Cloud region a project lives in. */
export const posthogRegionSchema = /* @__PURE__ */ z.enum(["us", "eu"]);
