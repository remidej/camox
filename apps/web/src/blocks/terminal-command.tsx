import { Type, createBlock } from "camox/createBlock";
import { Check, Copy } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

const terminalCommand = createBlock({
  id: "terminal-command",
  title: "Terminal Command",
  description:
    "Use this block to display a terminal command that users can easily copy. Perfect for setup instructions, installation commands, or any CLI commands intended for developers.",
  content: {
    label: Type.String({
      default: "Create a new Camox website in your terminal:",
      title: "Label",
    }),
    command: Type.String({
      default: "npm create camox",
      title: "Command",
    }),
  },
  component: CopyTerminalCommandComponent,
});

function CopyTerminalCommandComponent() {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = (command: string) => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="dark py-16 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <terminalCommand.Field name="label">
            {(content) => (
              <div className="mb-4 text-sm text-muted-foreground">
                {content}
              </div>
            )}
          </terminalCommand.Field>

          <terminalCommand.Field name="command">
            {(content) => (
              <div className="relative group">
                <div
                  onClick={() => handleCopy(content)}
                  className="bg-gray-950 border border-gray-800 rounded-lg p-6 cursor-pointer hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <code className="text-2xl md:text-3xl font-mono text-gray-100 flex-1">
                      {content}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 h-10 w-10 text-gray-400 hover:text-gray-100 hover:bg-gray-800"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(content);
                      }}
                    >
                      {copied ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <Copy className="h-5 w-5" />
                      )}
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
