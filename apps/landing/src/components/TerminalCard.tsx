import { Check, Copy } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

type TerminalCardProps = {
  children: ReactNode;
};

export function TerminalCard({ children }: TerminalCardProps) {
  const commandRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = commandRef.current?.textContent?.trim() ?? "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border-brand bg-canvas ring-brand/15 shadow-brand/20 rounded-card flex items-center gap-4 border-2 px-6 py-5 font-mono shadow-2xl ring-8">
      <span aria-hidden className="text-ink-muted shrink-0 text-xl font-bold select-none">
        $
      </span>
      <div ref={commandRef} className="min-w-0 flex-1 overflow-x-auto">
        {children}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy command"}
        className="text-ink-muted hover:text-ink rounded-control hover:bg-ink/10 inline-flex size-10 shrink-0 items-center justify-center transition-colors"
      >
        {copied ? <Check className="text-brand size-5" /> : <Copy className="size-5" />}
      </button>
    </div>
  );
}
