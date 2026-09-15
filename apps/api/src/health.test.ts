import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import app from "./index";

describe("GET /health", () => {
  it("checks D1 without requiring authentication", async () => {
    const response = await app.request("/health", {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 503 without exposing database errors", async () => {
    const bindings = {
      ...env,
      DB: {
        prepare: vi.fn().mockImplementation(() => {
          throw new Error("Private database error");
        }),
      } as unknown as D1Database,
    };
    const response = await app.request("/health", {}, bindings);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
