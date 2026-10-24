// The `camox` skill's references for code, from the SDK this API ships with: what the agent reads
// to write code the way Camox expects. The CLI's references stay out, since the agent works
// through its tools, not the CLI.
import artifacts from "../../../../../packages/sdk/skills/camox/references/artifacts.md";
import blockDefinitions from "../../../../../packages/sdk/skills/camox/references/block-definitions.md";
import domIntegrations from "../../../../../packages/sdk/skills/camox/references/dom-integrations.md";
import fieldStyling from "../../../../../packages/sdk/skills/camox/references/field-styling.md";
import layoutDefinitions from "../../../../../packages/sdk/skills/camox/references/layout-definitions.md";
import localization from "../../../../../packages/sdk/skills/camox/references/localization.md";
import routedLayouts from "../../../../../packages/sdk/skills/camox/references/routed-layouts.md";
import skill from "../../../../../packages/sdk/skills/camox/SKILL.md";

/**
 * The `camox` skill's paragraph on interactive blocks (spec #560, section 15), which the agent's
 * instructions carry: the skill itself isn't mounted.
 */
export const INTERACTIVE_BLOCKS = (() => {
  const section = /^## Interactive blocks\n+([\s\S]+?)(?=\n## |$)/m.exec(skill)?.[1]?.trim();
  if (!section) throw new Error("The camox skill has no Interactive blocks section");
  return section;
})();

/** Where the references are mounted in the agent's environment, read-only. */
export const SKILL_REFERENCES_DIR = "/.camox/skills/camox/references";

/** Each reference's file name, with its text and when to read it, as `SKILL.md` routes to it. */
export const SKILL_REFERENCES = [
  {
    file: "block-definitions.md",
    text: blockDefinitions,
    when: "creating a block in `src/blocks/`, or changing its schema or field rendering",
  },
  {
    file: "layout-definitions.md",
    text: layoutDefinitions,
    when: "creating or changing a layout, a shell for editor-created pages, with its navbar and footer slots",
  },
  {
    file: "routed-layouts.md",
    text: routedLayouts,
    when: "creating or changing a singleton page or a derived route in `src/layouts/`",
  },
  {
    file: "localization.md",
    text: localization,
    when: "anything every locale must render: visible text, internal links, a locale switcher, a loader's localized data",
  },
  {
    file: "field-styling.md",
    text: fieldStyling,
    when: "customizing inline text and link formatting, or highlights",
  },
  {
    file: "artifacts.md",
    text: artifacts,
    when: "bespoke visuals or widgets as code: animations, 3D scenes, interactive widgets",
  },
  {
    file: "dom-integrations.md",
    text: domIntegrations,
    when: "DOM listeners, scrolling, browser scripts or third-party widgets",
  },
] as const;
