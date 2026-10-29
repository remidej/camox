import { Avatar, AvatarFallback, AvatarGroup } from "@camox/ui/avatar";
import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Check, Copy, ExternalLink } from "lucide-react";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { CLIENT_LOGO_PATHS } from "./clientLogoPaths";

/**
 * Common AI apps that take a remote MCP server, with their guide to adding one. In the logo row
 * each one overlaps the one before it, so the last is on top.
 */
const CLIENTS = [
  {
    name: "GitHub Copilot",
    Logo: pathLogo(CLIENT_LOGO_PATHS.copilot),
    docs: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
  },
  {
    name: "Grok Bot",
    Logo: GrokBotLogo,
    // There's no official guide: Grok Bot adds a connector when asked in its chat.
    docs: "https://composio.dev/blog/how-to-add-mcp-servers-to-grok-bot",
  },
  {
    name: "ChatGPT",
    Logo: pathLogo(CLIENT_LOGO_PATHS.chatgpt),
    docs: "https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta",
  },
  {
    name: "Claude",
    Logo: pathLogo(CLIENT_LOGO_PATHS.claude, "#D97757"),
    docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
];

type LogoProps = { className?: string };

/** A logo drawn as one path on a 24×24 box, in the brand's color or the text's. */
function pathLogo(d: string, color = "currentColor") {
  return function PathLogo({ className }: LogoProps) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={className} fill={color}>
        <path d={d} />
      </svg>
    );
  };
}

/** Grok Bot's mark, drawn after its app icon: a rounded blob with two slanted eyes cut out. */
function GrokBotLogo({ className }: LogoProps) {
  const mask = React.useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <mask id={mask}>
        <path
          fill="white"
          d="M0.5 9.5C5 5.5 12 3.2 17.5 4c4 .6 6 4 6 8.5V19c0 2.5-2 4.5-4.5 4.5H5C2.5 23.5.5 21.5.5 19Z"
        />
        <ellipse fill="black" cx="11" cy="14" rx="1.7" ry="3.6" transform="rotate(-35 11 14)" />
        <ellipse
          fill="black"
          cx="17.6"
          cy="10.4"
          rx="1.6"
          ry="3.3"
          transform="rotate(-35 17.6 10.4)"
        />
      </mask>
      <rect width="24" height="24" mask={`url(#${mask})`} />
    </svg>
  );
}

/**
 * Under the Chat widget's composer, what invites a member to connect their own AI to Camox as a
 * Connected Agent (ADR 0030): the logos of common AI apps, opening a dialog with the link to
 * Camox's MCP server and each app's guide to adding an MCP server.
 */
export function ConnectAgent() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-muted text-muted-foreground hover:text-foreground mx-2 mb-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors"
      >
        <AvatarGroup>
          {CLIENTS.map((client) => (
            <Avatar key={client.name} size="sm">
              <AvatarFallback className="bg-background text-foreground">
                <client.Logo className="size-3.5" />
              </AvatarFallback>
            </Avatar>
          ))}
        </AvatarGroup>
        Connect your AI
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <ConnectAgentContent />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConnectAgentContent() {
  const { apiUrl } = React.useContext(AuthContext)!;
  const url = `${apiUrl}/mcp`;
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect your AI to Camox's MCP server</DialogTitle>
        <DialogDescription>
          Add this URL to your AI as a remote MCP server, then sign in to Camox. Your AI can then
          ask Camox's agent for changes, with what it knows about your business.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={copy}
          className="bg-muted hover:bg-muted/70 truncate rounded-lg border px-3 py-3 text-left font-mono text-sm transition-colors"
        >
          {url}
        </button>
        <Button size="lg" onClick={copy}>
          {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
          {copied ? "Copied" : "Copy MCP URL"}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium">How to add an MCP server in</p>
        <ul className="grid grid-cols-2 gap-1">
          {CLIENTS.map((client) => (
            <li key={client.name}>
              <a
                href={client.docs}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
              >
                <client.Logo className="size-4 shrink-0" />
                <span className="flex-1 truncate">{client.name}</span>
                <ExternalLink className="text-muted-foreground size-3.5 shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-muted-foreground text-xs">
        It acts as you, with your permissions. It can't publish: you review and publish here.
      </p>
    </>
  );
}
