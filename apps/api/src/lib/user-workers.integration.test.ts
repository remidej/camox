import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Bindings } from "../types";
import { uploadUserWorker, type UserWorker } from "./user-workers";

type Fakes = {
  cloudflareCalls(project: string): Promise<{ call: string }[]>;
  holdCloudflareCalls(project: string, pattern: string): Promise<void>;
  letGoCloudflareCalls(project: string, pattern: string): Promise<void>;
  userWorker(name: string): Promise<{ assets: Record<string, { text: string }> } | null>;
};

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;
const bindings = env as unknown as Bindings;

/** A user Worker with `count` assets no other test uploaded. */
function workerWithAssets(count: number): UserWorker {
  const marker = crypto.randomUUID();
  return {
    mainModule: "index.js",
    modules: [
      {
        name: "index.js",
        content: new TextEncoder().encode("export default {};\n"),
        type: "application/javascript+module",
      },
    ],
    compatibilityDate: "2026-04-11",
    compatibilityFlags: [],
    vars: {},
    assets: Array.from({ length: count }, (_, at) => ({
      path: `/icons/${at}.svg`,
      content: new TextEncoder().encode(`<svg><!-- ${marker} ${at} --></svg>`),
      contentType: "image/svg+xml",
    })),
    assetRules: {},
    tags: [],
  };
}

describe("uploading a user Worker", () => {
  it("uploads the buckets of assets Cloudflare asks for all at once", async () => {
    const project = crypto.randomUUID();
    const name = `${project}-publish-${crypto.randomUUID()}`;
    // The fake API asks for two files a bucket: three buckets.
    const worker = workerWithAssets(6);
    const UPLOADING = "POST assets/upload";
    await fakes.holdCloudflareCalls(project, UPLOADING);

    const uploading = uploadUserWorker(bindings, name, worker);
    // Every bucket is sent while none was answered.
    await vi.waitFor(
      async () => {
        const calls = await fakes.cloudflareCalls(project);
        expect(calls.filter(({ call }) => call.includes(UPLOADING))).toHaveLength(3);
      },
      { timeout: 5_000, interval: 20 },
    );
    await fakes.letGoCloudflareCalls(project, UPLOADING);
    const uploaded = await uploading;

    expect(uploaded).toMatchObject({ assets: 6, assetsUploaded: 6, assetBuckets: 3 });
    const served = await fakes.userWorker(name);
    expect(Object.keys(served!.assets)).toHaveLength(6);
  });
});
