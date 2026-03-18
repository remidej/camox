import * as React from "react";

import { INPUT_BASE_STYLES, INPUT_FOCUS_STYLES, cn } from "../lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        INPUT_BASE_STYLES,
        INPUT_FOCUS_STYLES,
        "file:text-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 h-9 w-full min-w-0 px-3 py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
