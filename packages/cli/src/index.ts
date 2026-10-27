import { or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { runSync } from "@optique/run";

import * as login from "./commands/login";
import * as logout from "./commands/logout";
import * as release from "./commands/release";

const program = defineProgram({
  parser: or(login.parser, logout.parser, release.parser),
  metadata: {
    name: "camox",
    brief: message`Camox CLI`,
  },
});

const result = runSync(program, { help: "both" });

switch (result.command) {
  case "login":
    await login.handler();
    break;
  case "logout":
    logout.handler(result);
    break;
  case "release":
    release.handler(result);
    break;
}
