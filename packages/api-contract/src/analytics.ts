import { z } from "zod";

/**
 * A GA4 measurement ID: `G-` followed by uppercase letters and digits. Shared so the dashboard
 * checks an ID by the API's own rule before saving it.
 */
export const ga4MeasurementIdSchema = /* @__PURE__ */ z
  .string()
  .regex(/^G-[A-Z0-9]+$/, "Not a GA4 measurement ID");
