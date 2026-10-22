import { or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { runSync } from "@optique/run";

import * as blocks from "./commands/blocks";
import * as discard from "./commands/discard";
import * as files from "./commands/files";
import * as init from "./commands/init";
import * as layouts from "./commands/layouts";
import * as locales from "./commands/locales";
import * as login from "./commands/login";
import * as logout from "./commands/logout";
import * as pages from "./commands/pages";
import * as preview from "./commands/preview";
import * as publish from "./commands/publish";
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
  | Parameters<typeof release.handler>[0]
  | Parameters<typeof preview.handler>[0]
  | Parameters<typeof status.handler>[0]
  | Parameters<typeof pages.handler>[0]
  | Parameters<typeof blocks.handler>[0]
  | Parameters<typeof layouts.handler>[0]
  | Parameters<typeof locales.handler>[0]
  | Parameters<typeof publish.handler>[0]
  | Parameters<typeof discard.handler>[0]
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
    layouts.parser,
    locales.parser,
    publish.parser,
    discard.parser,
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
    release.handler(result);
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
  case "pages.set-seo":
  case "pages.set-layout":
  case "pages.delete":
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
  case "files.upload":
  case "files.update":
  case "files.get":
  case "files.list":
    await files.handler(result);
    break;
  case "layouts.list":
  case "layouts.get":
    await layouts.handler(result);
    break;
  case "locales.list":
  case "locales.add":
  case "locales.remove":
  case "locales.set-default-tag":
    await locales.handler(result);
    break;
  case "publish":
    await publish.handler(result);
    break;
  case "discard":
    await discard.handler(result);
    break;
}
