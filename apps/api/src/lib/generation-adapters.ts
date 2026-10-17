import { env } from "cloudflare:workers";
import { Context } from "effect";

import type { Bindings } from "../types";
import { AiModel } from "./ai-model";
import { afterResponse, Background } from "./background";
import { durableObjectScheduler, GenerationScheduler } from "./generation-scheduler";
import { openRouterModel } from "./open-router-model";

export type GenerationServices = AiModel | GenerationScheduler | Background;

/**
 * The model and the scheduler that generated values are produced with, from the Worker's
 * bindings, and where scheduling runs: after a request answered, unless `background` says
 * otherwise. Every unit of work runs with them (`runService`, the job Durable Object). Tests swap
 * in a scripted model and a recording scheduler (`test/generation.ts`).
 */
export const generationServices = (
  bindings = env as unknown as Bindings,
  background: Background["Service"] = afterResponse,
) =>
  Context.make(AiModel, openRouterModel(bindings.OPEN_ROUTER_API_KEY)).pipe(
    Context.add(GenerationScheduler, durableObjectScheduler(bindings.AI_JOB_SCHEDULER)),
    Context.add(Background, background),
  );
