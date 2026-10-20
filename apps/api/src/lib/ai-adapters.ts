import { env } from "cloudflare:workers";
import { Context } from "effect";

import type { TranslationSettled } from "../domains/translations/service";
import type { Bindings } from "../types";
import { durableObjectQueue, AiJobQueue } from "./ai-job-queue";
import { AiModel } from "./ai-model";
import { afterResponse, Background } from "./background";
import { openRouterModel } from "./open-router-model";
import { withTranslationSettled } from "./translation-settled";

export type AiServices = AiModel | AiJobQueue | Background | TranslationSettled;

/**
 * The model and the job queue that generated values and translations are produced with, from the
 * Worker's bindings, and where scheduling runs: after a request answered, unless `background`
 * says otherwise. Every unit of work runs with them (`runService`, the job Durable Object). Tests
 * swap in a scripted model and a recording queue (`test/generation.ts`).
 */
export const aiServices = (
  bindings: Bindings = env,
  background: Background["Service"] = afterResponse,
) =>
  withTranslationSettled(
    Context.make(AiModel, openRouterModel(bindings.OPEN_ROUTER_API_KEY)).pipe(
      Context.add(AiJobQueue, durableObjectQueue(bindings.AI_JOB_SCHEDULER)),
      Context.add(Background, background),
    ),
  );
