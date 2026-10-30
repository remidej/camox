import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { describe, expect, it } from "vite-plus/test";

import { callColumns, meteredModels } from "./usage";

// What a thread's models note of each call from OpenRouter's raw stream, which pi-ai leaves out
// of the message it returns: the provider the call was routed to, and the cost billed.

const MODEL = "anthropic/claude-haiku-5.5";

/** One answer of OpenRouter's Anthropic API, as it streams it. */
type Answer = { id: string; provider: string; cost?: number; text: string };

/**
 * OpenRouter answering calls on its Anthropic API, each with the next of `answers`, its events
 * shaped as OpenRouter sends them. A call waits for `gate` before its last events, when given.
 */
const openRouter = (answers: Answer[], gate?: Promise<void>) => async () => {
  const { id, provider, cost, text } = answers.shift()!;
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 };
  const event = (type: string, data: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const start = [
    event("message_start", {
      message: {
        id,
        type: "message",
        role: "assistant",
        content: [],
        model: MODEL,
        stop_reason: null,
        usage,
        provider,
      },
    }),
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    event("content_block_delta", { index: 0, delta: { type: "text_delta", text } }),
  ];
  const end = [
    event("content_block_stop", { index: 0 }),
    event("message_delta", {
      delta: { stop_reason: "end_turn" },
      usage: { ...usage, ...(cost === undefined ? {} : { cost }) },
    }),
    event("message_stop", {}),
  ];
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(start.join("")));
      await gate;
      controller.enqueue(encoder.encode(end.join("")));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
};

const openRouterModels = () => {
  const models = createModels();
  models.setProvider(openrouterProvider());
  const model = models.getModel("openrouter", MODEL)!;
  return { models, model };
};

const ask = (text: string) => ({
  messages: [{ role: "user" as const, content: text, timestamp: Date.now() }],
});

describe("a thread's metered models", () => {
  it("note the provider and the cost OpenRouter billed for a call", async () => {
    const { models, model } = openRouterModels();
    const metered = meteredModels(models);
    const fetch = openRouter([
      { id: "msg_1", provider: "Amazon Bedrock", cost: 0.0000035, text: "Hello" },
    ]);

    const message = await metered.models.completeSimple(model, ask("Hi"), { apiKey: "-", fetch });

    expect(message.responseId).toBe("msg_1");
    expect(callColumns(message, metered.billed(message))).toMatchObject({
      provider: "Amazon Bedrock",
      costMicroUsd: 4,
      costSource: "billed",
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("tell each call apart from another streaming at the same time", async () => {
    const { models, model } = openRouterModels();
    const metered = meteredModels(models);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = openRouter(
      [
        { id: "msg_a", provider: "Anthropic", cost: 0.001, text: "A" },
        { id: "msg_b", provider: "Google", cost: 0.002, text: "B" },
      ],
      gate,
    );

    const first = metered.models.completeSimple(model, ask("A"), { apiKey: "-", fetch });
    const second = metered.models.completeSimple(model, ask("B"), { apiKey: "-", fetch });
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(metered.billed(a)).toEqual({ provider: "Anthropic", costMicroUsd: 1_000 });
    expect(metered.billed(b)).toEqual({ provider: "Google", costMicroUsd: 2_000 });
  });

  it("price a call OpenRouter billed nothing for from pi-ai's catalog", async () => {
    const { models, model } = openRouterModels();
    const metered = meteredModels(models);
    const fetch = openRouter([{ id: "msg_1", provider: "Anthropic", text: "Hello" }]);

    const message = await metered.models.completeSimple(model, ask("Hi"), { apiKey: "-", fetch });

    const columns = callColumns(message, metered.billed(message));
    expect(columns.costSource).toBe("estimated");
    expect(columns.costMicroUsd).toBe(Math.round(message.usage.cost.total * 1_000_000));
    expect(columns.costMicroUsd).toBeGreaterThan(0);
  });

  it("hand each completed call to `completed`, as Pi's compactions are recorded", async () => {
    const { models, model } = openRouterModels();
    const completed: unknown[] = [];
    const metered = meteredModels(models, (message, billed) =>
      completed.push({ id: message.responseId, billed }),
    );
    const fetch = openRouter([{ id: "msg_1", provider: "Anthropic", cost: 0.01, text: "Hi" }]);

    await metered.models.completeSimple(model, ask("Summarize"), { apiKey: "-", fetch });

    expect(completed).toEqual([
      { id: "msg_1", billed: { provider: "Anthropic", costMicroUsd: 10_000 } },
    ]);
  });
});
