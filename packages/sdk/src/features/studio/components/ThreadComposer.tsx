import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@camox/ui/input-group";
import { ArrowUp } from "lucide-react";
import { useState } from "react";

/** Where an editor writes to the agent: Enter sends, Shift+Enter adds a line. */
export function ThreadComposer({
  onSend,
  disabled = false,
}: {
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
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
        <InputGroupTextarea
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
        <InputGroupAddon align="block-end">
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            className="ml-auto"
            disabled={!canSend}
          >
            <ArrowUp />
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
