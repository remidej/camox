import type { VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import {
  createContext,
  use,
  useId,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * A native modal dialog: a <dialog> its buttons open and close with invoker commands
 * (`command`/`commandfor`), so it needs no JS where browsers support them. Elsewhere the
 * buttons run the same command from a click handler. The browser traps focus inside, closes it
 * on Escape and returns focus to the button that opened it. Its content is in the page's markup
 * while it's closed.
 */

type DialogCommand = "show-modal" | "close";

declare module "react" {
  interface ButtonHTMLAttributes<T> {
    command?: DialogCommand | (string & {});
    commandfor?: string;
  }
}

const DialogContext = createContext<{ id: string; titleId: string } | undefined>(undefined);

function useDialog() {
  const dialog = use(DialogContext);
  if (!dialog) throw new Error("Use the Dialog's parts inside a <Dialog>.");
  return dialog;
}

/** Groups a dialog's trigger and content. */
function Dialog({ children }: { children: ReactNode }) {
  const id = useId();
  const titleId = useId();
  return <DialogContext value={{ id, titleId }}>{children}</DialogContext>;
}

/** Runs the button's command where the browser doesn't support invoker commands yet. */
function runCommand(event: MouseEvent<HTMLButtonElement>, command: DialogCommand, id: string) {
  const button: { commandForElement?: unknown } & HTMLButtonElement = event.currentTarget;
  // Browsers with invoker commands have the property, `null` when nothing is targeted.
  if (button.commandForElement !== undefined) return;
  const dialog = button.ownerDocument.getElementById(id) as HTMLDialogElement | null;
  if (command === "show-modal") dialog?.showModal();
  else dialog?.close();
}

type DialogButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

function DialogButton({
  command,
  onClick,
  ...props
}: DialogButtonProps & { command: DialogCommand }) {
  const { id } = useDialog();
  return (
    <Button
      {...props}
      command={command}
      commandfor={id}
      onClick={(event) => {
        onClick?.(event);
        runCommand(event, command, id);
      }}
    />
  );
}

/** The button opening the dialog. Takes the Button's variants. */
function DialogTrigger(props: DialogButtonProps) {
  return <DialogButton data-slot="dialog-trigger" {...props} command="show-modal" />;
}

/** A button closing the dialog, such as "Done". The dialog already has a close icon. */
function DialogClose(props: DialogButtonProps) {
  return <DialogButton data-slot="dialog-close" variant="outline" {...props} command="close" />;
}

/** The dialog itself. Put a DialogTitle first: it names the dialog. */
function DialogContent({
  className,
  children,
  closeLabel = "Close",
  ...props
}: ComponentProps<"dialog"> & {
  /** Accessible name of the close icon button. */
  closeLabel?: string;
}) {
  const { id, titleId } = useDialog();
  return (
    <dialog
      data-slot="dialog-content"
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "bg-canvas text-ink rounded-card relative m-auto w-[calc(100%-2*var(--spacing-gutter))] max-w-lg flex-col gap-4 border p-6 shadow-xl open:flex backdrop:bg-black/50",
        className,
      )}
      {...props}
    >
      {children}
      <DialogButton
        variant="plain"
        size="sm"
        aria-label={closeLabel}
        command="close"
        className="absolute top-3 right-3 px-2"
      >
        <XIcon />
      </DialogButton>
    </dialog>
  );
}

/** The dialog's heading, which names it for assistive technology. */
function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  const { titleId } = useDialog();
  return <h2 {...props} id={titleId} className={cn("text-title pr-8", className)} />;
}

export { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose };
