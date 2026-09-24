import { or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { runSync } from "@optique/run";

import * as blocks from "./commands/blocks";
import * as comments from "./commands/comments";
import * as env from "./commands/env";
import * as files from "./commands/files";
import * as init from "./commands/init";
import * as layouts from "./commands/layouts";
import * as login from "./commands/login";
import * as logout from "./commands/logout";
import * as pages from "./commands/pages";
import * as preview from "./commands/preview";
import * as release from "./commands/release";
import * as status from "./commands/status";

// With many top-level parsers and subcommands, optique's variadic `or`
// overload + recursive command inference exceeds what TypeScript can resolve,
// so `runSync` ends up returning `unknown`. We narrow at the call site via a
// hand-written discriminator union — each handler still type-checks its own
// args internally.
type Result =
  | { command: "init" }
  | { command: "login" }
  | { command: "logout"; cwd?: string }
  | { command: "release" }
  | Parameters<typeof preview.handler>[0]
  | Parameters<typeof status.handler>[0]
  | Parameters<typeof pages.handler>[0]
  | Parameters<typeof blocks.handler>[0]
  | Parameters<typeof comments.handler>[0]
  | Parameters<typeof layouts.handler>[0]
  | Parameters<typeof env.handler>[0]
  | Parameters<typeof files.handler>[0];

const program = defineProgram({
  parser: or(
    init.parser,
    login.parser,
    logout.parser,
    release.parser,
    status.parser,
    preview.parser,
    pages.parser,
    blocks.parser,
    comments.parser,
    layouts.parser,
    env.parser,
    files.parser,
  ),
  metadata: {
    name: "camox",
    brief: message`Camox CLI`,
  },
});

const result = runSync(program as never, { help: "both" }) as Result;

switch (result.command) {
  case "init":
    await init.handler();
    break;
  case "login":
    await login.handler();
    break;
  case "logout":
    logout.handler(result);
    break;
  case "release":
    release.handler();
    break;
  case "preview":
    await preview.handler(result);
    break;
  case "status":
    await status.handler(result);
    break;
  case "pages.list":
  case "pages.get":
  case "pages.create":
  case "pages.update":
  case "pages.set-layout":
  case "pages.delete":
  case "pages.publish":
  case "pages.unpublish":
  case "pages.discard-changes":
    await pages.handler(result);
    break;
  case "blocks.types":
  case "blocks.describe":
  case "blocks.get":
  case "blocks.get-many":
  case "blocks.create":
  case "blocks.edit":
  case "blocks.move":
  case "blocks.delete":
    await blocks.handler(result);
    break;
  case "comments.list":
  case "comments.resolve":
    await comments.handler(result);
    break;
  case "files.upload":
  case "files.update":
  case "files.get":
  case "files.list":
    await files.handler(result);
    break;
  case "layouts.list":
    await layouts.handler(result);
    break;
  case "env.check":
  case "env.push":
  case "env.pull":
    await env.handler(result);
    break;
}
