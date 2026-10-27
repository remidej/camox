import { z } from "zod";

/**
 * Project Slugs Camox keeps for its own hosts and pages, so no project's `<slug>.camox.site`
 * looks like one of them.
 */
export const RESERVED_PROJECT_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "dashboard",
  "studio",
  "sites",
  "site",
  "docs",
  "blog",
  "help",
  "support",
  "status",
  "admin",
  "auth",
  "login",
  "mail",
  "email",
  "cdn",
  "static",
  "assets",
  "files",
  "camox",
]);

/**
 * A Project Slug: one lowercase DNS label, the only depth Universal SSL covers on `camox.site`,
 * made of letters, digits and inner hyphens.
 */
export const projectSlugSchema = /* @__PURE__ */ z
  .string()
  .min(1, "Enter a slug")
  .max(63, "Use at most 63 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and hyphens, without a hyphen at either end",
  );

/**
 * The address a project's website is served at: its Custom Domain when it has one, else its
 * Project Slug's `camox.site` subdomain, which then redirects to it (ADR 0028).
 */
export const projectWebsiteUrl = (project: { slug: string; customDomain: string | null }) =>
  `https://${project.customDomain ?? `${project.slug}.camox.site`}`;

/** Why a slug can't be given to a new project. */
export type UnavailableSlugReason = "invalid" | "reserved" | "taken";

/** What a member is told when a slug can't be used, by reason. */
export const UNAVAILABLE_SLUG_MESSAGES: Record<UnavailableSlugReason, string> = {
  invalid: "Use lowercase letters, digits and hyphens, without a hyphen at either end.",
  reserved: "This slug is reserved by Camox. Choose another.",
  taken: "This slug is already taken. Choose another.",
};

/**
 * Where a project is in its life: `settingUp` from its creation until its first release
 * succeeds, then `live`. `setupFailed` when its setup gave up: Camox is told and fixes it.
 */
export type ProjectStatus = "settingUp" | "live" | "setupFailed";

/**
 * The steps a project's setup goes through before it's live, as its page lists them: copying the
 * Template into its repo, then its first release building it and serving it from its Worker.
 */
export type ProjectSetupStep = "copyTemplate" | "build" | "serve";

export const PROJECT_SETUP_STEPS: readonly ProjectSetupStep[] = ["copyTemplate", "build", "serve"];

/**
 * A social profile's address: an absolute `https` URL. Shared so the studio checks a profile by
 * the API's own rule before saving it.
 */
export const socialProfileUrlSchema = /* @__PURE__ */ z
  .string()
  .max(2048, "Use a shorter URL")
  .refine(isHttpsUrl, "Enter a URL starting with https://");

function isHttpsUrl(value: string) {
  if (!value.startsWith("https://")) return false;
  try {
    return new URL(value).hostname !== "";
  } catch {
    return false;
  }
}
