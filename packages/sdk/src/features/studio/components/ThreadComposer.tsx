import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@camox/ui/input-group";
import { ArrowUp, SquareDashedMousePointer, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Where an editor writes to the agent: Enter sends, Shift+Enter adds a line. While a run is
 * going, sending steers it, and a Stop button sits beside Send. Over the message, what the
 * editor has selected, which their messages carry to the agent until they clear it. A message
 * filled in from elsewhere in the studio replaces what the editor wrote, for them to send. Given a
 * `carry`, the composer of the next thread goes on from this one, as when the studio enters the
 * draft the editor's request was handed off to: with what they were writing, focused if it was.
 */
export function ThreadComposer({
  onSend,
  onStop,
  selection,
  onClearSelection,
  running = false,
  disabled = false,
  filled,
  carry,
}: {
  onSend?: (text: string) => void;
  onStop?: () => void;
  /** What the editor selected, as the studio names it. */
  selection?: string;
  onClearSelection?: () => void;
  /** Whether a run is going, which Stop ends. */
  running?: boolean;
  disabled?: boolean;
  /** A message filled in from elsewhere, each with its own id, so the same text fills again. */
  filled?: { text: string; id: number };
  /** What the composer of the last thread left, for this one to go on from. */
  carry?: ComposerCarrier;
}) {
  const [text, setText] = useState(() => carry?.held()?.text ?? "");
  const [filledId, setFilledId] = useState<number>();
  if (filled && filled.id !== filledId) {
    setFilledId(filled.id);
    setText(filled.text);
  }
  const box = useRef<HTMLTextAreaElement>(null);
  // The next composer renders before this one unmounts: it finds the text already carried.
  useEffect(() => {
    carry?.hold({ text, focused: carry.held()?.focused ?? false });
  }, [carry, text]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!carry || !element) return;
    if (carry.held()?.focused) element.focus();
    // Read before the textarea leaves the document, which would take its focus.
    return () =>
      carry.hold({ text: element.value, focused: element.ownerDocument.activeElement === element });
  }, [carry]);
  // The editor goes on from the filled message.
  useEffect(() => {
    if (filledId !== undefined) box.current?.focus();
  }, [filledId]);
  const message = text.trim();
  const canSend = !disabled && message !== "" && onSend !== undefined;

  const submit = () => {
    if (!canSend) return;
    onSend(message);
    setText("");
  };

  return (
    <form
      className="p-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputGroup>
        {selection && (
          <InputGroupAddon align="block-start" className="border-input border-b">
            <SelectionChip name={selection} onClear={onClearSelection} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={box}
          aria-label="Message"
          placeholder="Message Camox…"
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          className="max-h-48 min-h-14"
        />
        <InputGroupAddon align="block-end" className="justify-end">
          {running && onStop && (
            <InputGroupButton
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={disabled}
              onClick={onStop}
            >
              <Square className="fill-current" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          )}
          <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={!canSend}>
            <ArrowUp />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** What a thread's composer leaves the next thread's: what the editor wrote, and if they were. */
export type ComposerCarry = { text: string; focused: boolean };

/** Holds what one thread's composer leaves for the next. */
export type ComposerCarrier = {
  held: () => ComposerCarry | null;
  hold: (carry: ComposerCarry) => void;
};

/** A carrier that lasts as long as the component that keeps it. */
export function useComposerCarrier(): ComposerCarrier {
  const [carrier] = useState(() => {
    let held: ComposerCarry | null = null;
    return {
      held: () => held,
      hold: (carry: ComposerCarry) => {
        held = carry;
      },
    };
  });
  return carrier;
}

/** The selection the editor's messages carry, by its name. */
function SelectionChip({ name, onClear }: { name: string; onClear?: () => void }) {
  return (
    <div
      aria-label="Selection"
      className="bg-muted text-foreground flex h-6 max-w-full min-w-0 cursor-default items-center gap-1 rounded-sm pr-0.5 pl-1.5 text-xs"
    >
      <SquareDashedMousePointer className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 truncate font-medium">{name}</span>
      {onClear && (
        <InputGroupButton
          type="button"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground size-5 shrink-0"
          onClick={onClear}
        >
          <X className="size-3" />
          <span className="sr-only">Clear selection</span>
        </InputGroupButton>
      )}
    </div>
  );
}
