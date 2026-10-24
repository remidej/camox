// `cloudflare:workers` as the tests need it in Node, where workerd doesn't provide it: an
// entrypoint is a class constructed with its context and bindings, as Cloudflare constructs it.
export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  protected ctx: ExecutionContext<Props>;
  protected env: Env;
  constructor(ctx: ExecutionContext<Props>, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
