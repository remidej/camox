import { createBlock } from "camox/createBlock";
import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

const terminalCommand = createBlock({
  id: "terminal-command",
  title: "Terminal Command",
  description:
    "Use this block to display a terminal command that users can easily copy. Perfect for setup instructions, installation commands, or any CLI commands intended for developers.",
  content: (field) => ({
    label: field.string({
      default: "Create a new Camox website in your terminal:",
      title: "Label",
    }),
    command: field.string({
      default: "npm create camox",
      title: "Command",
    }),
  }),
  toReact: CopyTerminalCommandComponent,
  toMarkdown: ({ content }) => [content.label, `\`${content.command}\``],
});

function CopyTerminalCommandComponent() {
  const [copied, setCopied] = React.useState(false);
  const commandRef = React.useRef<HTMLElement>(null);

  const handleCopy = () => {
    const text = commandRef.current?.textContent ?? "";
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Section scheme="dark" className="py-16">
      <Container>
        <div className="mx-auto max-w-4xl">
          <terminalCommand.Field name="label">
            {(props) => <div {...props} className="text-ink-muted mb-4 text-sm" />}
          </terminalCommand.Field>

          <terminalCommand.Field name="command">
            {(props) => (
              <div {...props} className="group relative">
                <div
                  onClick={handleCopy}
                  className="rounded-card border-line bg-panel hover:border-ink/25 cursor-pointer border p-6 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <code ref={commandRef} className="flex-1 font-mono text-2xl md:text-3xl">
                      {props.children}
                    </code>
                    <Button
                      variant="plain"
                      aria-label="Copy command"
                      className="text-ink-muted hover:text-ink size-10 px-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy();
                      }}
                    >
                      {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </terminalCommand.Field>
        </div>
      </Container>
    </Section>
  );
}

export { terminalCommand as block };
