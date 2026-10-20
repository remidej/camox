import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";

import type { ThreadModel } from "../src/lib/thread-model";

// Stands in for the threads' model in integration tests that `vi.mock` it: pi-ai's
// fake provider answers what a test scripted. Thread Durable Objects run in the tests' isolate, so
// they share this module's provider.

const faux = fauxProvider();

/** The model every thread runs on, in tests. */
export const testThreadModel = (): ThreadModel => {
  const models = createModels();
  models.setProvider(faux.provider);
  const { provider, id } = faux.getModel();
  return { models, model: { provider, id }, thinkingLevel: "off" };
};

/**
 * Scripts the model's next answer, after `thinking` when given. An unscripted call fails like an
 * unreachable model.
 */
export const answerNext = (text: string, { thinking }: { thinking?: string } = {}) =>
  faux.appendResponses([
    fauxAssistantMessage([...(thinking ? [fauxThinking(thinking)] : []), fauxText(text)]),
  ]);

/**
 * Scripts the model's next answer, held until the returned function is called, as a model still
 * writing its answer.
 */
export const holdNextAnswer = (text: string) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  faux.appendResponses([
    async () => {
      await released;
      return fauxAssistantMessage([fauxText(text)]);
    },
  ]);
  return release;
};

/** How many times threads called the model since the test started. */
export const threadModelCalls = () => faux.state.callCount;

/** Forgets scripted answers and calls, between tests. */
export const forgetThreadModel = () => {
  faux.setResponses([]);
  faux.state.callCount = 0;
};
