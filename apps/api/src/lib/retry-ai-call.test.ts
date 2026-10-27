import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { retryAiCall } from "./retry-ai-call";

describe("retryAiCall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries transient failures and resolves with the eventual result", async () => {
    let attempts = 0;
    const result = Effect.runPromise(
      retryAiCall("test", () =>
        Effect.promise(async () => {
          attempts++;
          if (attempts < 3) throw new Error("OpenRouter 503");
          return "summary";
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(result).resolves.toBe("summary");
    expect(attempts).toBe(3);
  });

  it("rejects once its retries run out", async () => {
    let attempts = 0;
    const result = Effect.runPromise(
      retryAiCall("test", () =>
        Effect.promise(async () => {
          attempts++;
          throw new Error("OpenRouter 503");
        }),
      ),
    );
    const settled = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await settled).toMatchObject({ _tag: "AiCallError" });
    expect(attempts).toBeGreaterThan(1);
  });

  it("aborts a hung attempt when it times out", async () => {
    const signals: AbortSignal[] = [];
    const result = Effect.runPromise(
      retryAiCall("test", (abortController) => {
        signals.push(abortController.signal);
        return Effect.never;
      }),
    );
    const settled = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(await settled).toMatchObject({ _tag: "AiCallError", cause: { _tag: "TimeoutError" } });
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
