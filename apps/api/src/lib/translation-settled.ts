import { Context, Effect } from "effect";

import { publishWhenTranslated } from "../domains/drafts/publish";
import { TranslationSettled } from "../domains/translations/service";
import type { AiServices } from "./ai-adapters";
import type { AiJobQueue } from "./ai-job-queue";
import type { AiModel } from "./ai-model";
import type { Background } from "./background";

/**
 * The AI services, with what runs once a translation settles: Camox publishes its catch-up draft
 * once nothing is left to translate in it (ADR 0017), with the same services.
 */
export const withTranslationSettled = (
  services: Context.Context<AiModel | AiJobQueue | Background>,
): Context.Context<AiServices> => {
  const all: Context.Context<AiServices> = Context.add(services, TranslationSettled, {
    run: (db, draftId) =>
      Effect.suspend(() => publishWhenTranslated(db, draftId).pipe(Effect.provideContext(all))),
  });
  return all;
};
