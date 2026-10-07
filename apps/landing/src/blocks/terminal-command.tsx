import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import { TerminalCard } from "@/components/TerminalCard";

const terminalCommand = createBlock({
  id: "terminal-command",
  title: "Terminal Command",
  description:
    "Use this block as a primary call to action that displays a shell command users should copy and paste into their terminal. Place it prominently on landing or documentation pages (e.g. install, quickstart, getting started). Keep the command concise and on a single line. The block renders the command large with a centered label above it and a one-click copy-to-clipboard button.",
  content: (field) => ({
    label: field.string({
      default: "Get started in seconds",
      title: "Label",
    }),
    command: field.string({
      default: "npx create-camox@latest my-site",
      title: "Command",
    }),
  }),
  component: TerminalCommandComponent,
  toMarkdown: (c) => [c.label, `\`\`\`bash\n${c.command}\n\`\`\``],
});

function TerminalCommandComponent() {
  return (
    <BlockContainer>
      <div className="mx-auto max-w-xl">
        <terminalCommand.Field name="label">
          {(props) => (
            <p
              {...props}
              className="text-muted-foreground mb-4 text-center text-base font-medium"
            />
          )}
        </terminalCommand.Field>
        <TerminalCard>
          <terminalCommand.Field name="command">
            {(props) => (
              <code
                {...props}
                className="text-foreground block text-lg font-medium whitespace-nowrap"
              />
            )}
          </terminalCommand.Field>
        </TerminalCard>
      </div>
    </BlockContainer>
  );
}

export { terminalCommand as block };
