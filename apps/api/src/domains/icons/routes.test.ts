import { ICON_CATALOG_VERSION } from "@camox/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { iconRoutes } from "./routes";

const base = `/${ICON_CATALOG_VERSION}/api-test`;
describe("Camox icon delivery", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        prefix: "api-test",
        width: 24,
        height: 24,
        icons: { zap: { body: '<path d="M0 0h24" />' }, catalog: { body: "<path />" } },
        aliases: { reverse: { parent: "zap", hFlip: true } },
        info: {
          name: "Test",
          author: { name: "Artist" },
          license: { title: "MIT", url: "https://example.com/license" },
        },
      }),
    );
  });
  afterAll(() => vi.restoreAllMocks());

  it("serves normalized selected SVG data, attribution and immutable cache headers", async () => {
    const response = await iconRoutes.request(`${base}/reverse`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    const data = (await response.json()) as {
      body: string;
      attributes: { viewBox: string };
      attribution: { author: string };
    };
    expect(data.body).toContain("transform");
    expect(data.attributes.viewBox).toBe("0 0 24 24");
    expect(data.attribution.author).toBe("Artist");
  });

  it("serves picker names and license without shipping SVG catalog bodies", async () => {
    const response = await iconRoutes.request(`${base}/_catalog`);
    const data = (await response.json()) as { ids: string[]; license: { title: string } };
    expect(data.ids).toEqual(["api-test:catalog", "api-test:reverse", "api-test:zap"]);
    expect(data.license.title).toBe("MIT");
    expect(JSON.stringify(data)).not.toContain("<path");
    expect((await iconRoutes.request(`${base}/catalog`)).status).toBe(200);
  });

  it("rejects unknown versions, missing names and prototype properties", async () => {
    for (const path of ["/wrong/api-test/zap", `${base}/missing`, `${base}/constructor`]) {
      expect((await iconRoutes.request(path)).status).toBe(404);
    }
  });
});
