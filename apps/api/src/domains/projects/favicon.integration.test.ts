import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import app from "../../index";
import type { Bindings } from "../../types";

describe("GET /favicons/:projectId", () => {
  it("is not found for a project without a favicon", async () => {
    const response = await app.request("/favicons/987654", {}, env);

    expect(response.status).toBe(404);
  });

  it("serves the Camox mark for a project without a favicon when asked for a placeholder", async () => {
    const response = await app.request("/favicons/987654?placeholder=camox", {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await response.text()).toMatch(/^<svg/);
  });

  it("serves the Camox mark on its own", async () => {
    const response = await app.request("/favicons/placeholder", {}, env);

    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it("serves the uploaded favicon over the placeholder", async () => {
    await (env as unknown as Bindings).FILES_BUCKET.put("favicons/987655", "png-bytes", {
      httpMetadata: { contentType: "image/png" },
    });

    const response = await app.request("/favicons/987655?placeholder=camox", {}, env);

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("png-bytes");
  });
});
