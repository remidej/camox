import * as React from "react";

/**
 * A linked collection record: its title, its description when it has one, and its collection's
 * title. `leading` holds controls before it, such as a drag handle; `actions` holds trailing
 * controls such as unlink.
 */
export function RecordCard({
  label,
  description,
  collectionTitle,
  onOpen,
  leading,
  actions,
}: {
  label: string;
  /** The record's description, from its collection's `toDescription`. */
  description?: string | null;
  collectionTitle: string;
  onOpen?: () => void;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span data-record-title className="truncate text-sm font-medium">
          {label}
        </span>
        {description && (
          <span data-record-description className="text-muted-foreground truncate text-xs">
            {description}
          </span>
        )}
        <span className="text-muted-foreground truncate text-xs">{collectionTitle}</span>
      </span>
    </>
  );

  return (
    <div
      data-record-card
      className="text-foreground hover:bg-accent/75 flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-lg border-2 p-1"
    >
      {leading}
      {onOpen ? (
        <button
          type="button"
          aria-label={`Open ${label}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm p-1 text-left"
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2 p-1">{body}</div>
      )}
      {actions}
    </div>
  );
}
