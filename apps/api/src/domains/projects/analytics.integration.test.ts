import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callSeedingLive, createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";

async function fixture() {
  const base = await createProjectFixture(`analytics-${crypto.randomUUID()}`);
  const as = (user: typeof base.memberUser | null, headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, user, headers),
  });
  const setGa4 = (measurementId: string | null, user = base.memberUser) =>
    call(
      router.projects.updateAnalytics,
      { id: base.project.id, ga4: measurementId === null ? null : { measurementId } },
      as(user),
    );
  const setPosthog = (
    posthog: { projectApiKey: string; region: string } | null,
    user = base.memberUser,
  ) =>
    call(
      router.projects.updateAnalytics,
      // Typed loosely on purpose, so tests can send what the API must reject.
      { id: base.project.id, posthog: posthog as never },
      as(user),
    );
  const memberRead = () => call(router.projects.get, { id: base.project.id }, as(base.memberUser));
  return { ...base, as, setGa4, setPosthog, memberRead };
}

describe("Analytics providers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a member adds, changes and removes a GA4 measurement ID", async () => {
    const f = await fixture();
    expect((await f.memberRead()).analytics.ga4).toBeNull();

    await f.setGa4("G-ABC123XYZ9");
    expect((await f.memberRead()).analytics.ga4).toEqual({ measurementId: "G-ABC123XYZ9" });

    await f.setGa4("G-NEW0000001");
    expect((await f.memberRead()).analytics.ga4).toEqual({ measurementId: "G-NEW0000001" });

    await f.setGa4(null);
    expect((await f.memberRead()).analytics.ga4).toBeNull();
  });

  it("a member adds, changes and removes a PostHog key and region", async () => {
    const f = await fixture();
    expect((await f.memberRead()).analytics.posthog).toBeNull();

    await f.setPosthog({ projectApiKey: "phc_abc123", region: "us" });
    expect((await f.memberRead()).analytics.posthog).toEqual({
      projectApiKey: "phc_abc123",
      region: "us",
    });

    await f.setPosthog({ projectApiKey: "phc_other456", region: "eu" });
    expect((await f.memberRead()).analytics.posthog).toEqual({
      projectApiKey: "phc_other456",
      region: "eu",
    });

    await f.setPosthog(null);
    expect((await f.memberRead()).analytics.posthog).toBeNull();
  });

  it("GA4 and PostHog are set at the same time, and changing one leaves the other", async () => {
    const f = await fixture();
    await f.setGa4("G-ABC123XYZ9");
    await f.setPosthog({ projectApiKey: "phc_abc123", region: "eu" });
    expect((await f.memberRead()).analytics).toEqual({
      ga4: { measurementId: "G-ABC123XYZ9" },
      posthog: { projectApiKey: "phc_abc123", region: "eu" },
    });

    await f.setGa4(null);
    expect((await f.memberRead()).analytics).toEqual({
      ga4: null,
      posthog: { projectApiKey: "phc_abc123", region: "eu" },
    });
  });

  it("rejects a PostHog key without the phc_ prefix, and regions other than US or EU", async () => {
    const f = await fixture();
    for (const posthog of [
      // A personal API key, which must never reach a public page.
      { projectApiKey: "phx_abc123", region: "us" },
      { projectApiKey: "abc123", region: "us" },
      { projectApiKey: "phc_", region: "us" },
      { projectApiKey: "PHC_abc123", region: "us" },
      { projectApiKey: " phc_abc123", region: "us" },
      { projectApiKey: "phc_abc 123", region: "us" },
      { projectApiKey: "phc_abc123<script>", region: "us" },
      { projectApiKey: "phc_abc123", region: "" },
      { projectApiKey: "phc_abc123", region: "US" },
      { projectApiKey: "phc_abc123", region: "asia" },
    ]) {
      await expect(f.setPosthog(posthog), JSON.stringify(posthog)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect((await f.memberRead()).analytics.posthog).toBeNull();
  });

  it("changing a provider bumps the project's updated time", async () => {
    const f = await fixture();
    const before = (await f.memberRead()).updatedAt;
    // A later clock, so the bump can't land in the same millisecond as the project's creation.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(before + 60_000);
    await f.setGa4("G-ABC123XYZ9");
    expect((await f.memberRead()).updatedAt).toBe(before + 60_000);
  });

  it("rejects a malformed GA4 measurement ID", async () => {
    const f = await fixture();
    for (const measurementId of [
      "",
      "G-",
      "g-abc123",
      "G-abc123",
      "UA-12345-1",
      "GT-ABC123",
      "G-ABC 123",
      "G-ABC123<script>",
      " G-ABC123",
    ]) {
      await expect(f.setGa4(measurementId), measurementId).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect((await f.memberRead()).analytics.ga4).toBeNull();
  });

  it("forbids someone outside the project's organization", async () => {
    const f = await fixture();
    await expect(f.setGa4("G-ABC123XYZ9", f.outsiderUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      f.setPosthog({ projectApiKey: "phc_abc123", region: "us" }, f.outsiderUser),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(router.projects.get, { id: f.project.id }, f.as(f.outsiderUser)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await f.memberRead()).analytics).toEqual({ ga4: null, posthog: null });
  });

  it("forbids someone outside the project's organization from removing a provider", async () => {
    const f = await fixture();
    const providers = {
      ga4: { measurementId: "G-ABC123XYZ9" },
      posthog: { projectApiKey: "phc_abc123", region: "us" },
    };
    await f.setGa4(providers.ga4.measurementId);
    await f.setPosthog(providers.posthog);

    await expect(f.setGa4(null, f.outsiderUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.setPosthog(null, f.outsiderUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await f.memberRead()).analytics).toEqual(providers);
  });

  it("the public page data carries the providers, the same in every draft as on Live", async () => {
    const f = await fixture();
    await callSeedingLive(
      router.pages.create,
      { projectId: f.project.id, pathSegment: "", layoutId: f.layout.layoutId },
      f.as(f.memberUser),
    );
    // A draft that holds its own edit, started before the provider was added.
    const draftId = generateUuidv7();
    await call(
      router.pages.create,
      { projectId: f.project.id, pathSegment: "pricing", layoutId: f.layout.layoutId },
      f.as(f.memberUser, { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    );
    await f.setGa4("G-ABC123XYZ9");
    await f.setPosthog({ projectApiKey: "phc_abc123", region: "eu" });
    const providers = {
      ga4: { measurementId: "G-ABC123XYZ9" },
      posthog: { projectApiKey: "phc_abc123", region: "eu" },
    };

    const input = { projectSlug: f.project.slug, path: "/" };
    const reads = [
      ["Live, as a visitor", f.as(null)],
      ["a draft, as a member", f.as(f.memberUser, { [DRAFT_HEADER]: draftId })],
    ] as const;
    for (const [reader, options] of reads) {
      for (const read of [router.pages.getByPath, router.pages.getStructure]) {
        const { project } = await call(read, input, options);
        expect(project.analytics, reader).toEqual(providers);
      }
      const { project } = await call(
        router.layouts.get,
        { projectSlug: f.project.slug, layoutId: f.layout.layoutId },
        options,
      );
      expect(project.analytics, reader).toEqual(providers);
    }
  });
});
