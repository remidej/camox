// Vendored from https://github.com/dmmulroy/anti-slop at 13909c9e07590f5a85d93c62712259fe14a883f7,
// keeping only the rules this repo enables. The copy is ours to edit.
import { eslintCompatPlugin } from "@oxlint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-object-parameters": noObjectParametersRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
    "no-widen-then-assert": noWidenThenAssertRule,
  },
});
