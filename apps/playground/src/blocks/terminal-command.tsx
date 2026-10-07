import { createBlock } from "camox/createBlock";
import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";

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
  component: CopyTerminalCommandComponent,
  toMarkdown: (c) => [c.label, `\`${c.command}\``],
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
    <section className="dark bg-background py-16">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-4xl">
          <terminalCommand.Field name="label">
            {(props) => <div {...props} className="text-muted-foreground mb-4 text-sm" />}
          </terminalCommand.Field>

          <terminalCommand.Field name="command">
            {(props) => (
              <div {...props} className="group relative">
                <div
                  onClick={handleCopy}
                  className="cursor-pointer rounded-lg border border-gray-800 bg-gray-950 p-6 transition-colors hover:border-gray-700"
                >
                  <div className="flex items-center justify-between gap-4">
                    <code
                      ref={commandRef}
                      className="flex-1 font-mono text-2xl text-gray-100 md:text-3xl"
                    >
                      {props.children}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 shrink-0 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
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
      </div>
    </section>
  );
}

export { terminalCommand as block };
