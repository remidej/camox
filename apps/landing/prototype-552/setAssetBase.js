// PROTOTYPE #552: what a revision's loader would do before the bundle runs.
import { env } from "cloudflare:workers";
globalThis.__CAMOX_ASSET_BASE__ = env.CAMOX_ASSET_BASE;
