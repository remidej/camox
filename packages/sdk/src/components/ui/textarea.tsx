import * as React from "react";

import { INPUT_BASE_STYLES, INPUT_FOCUS_STYLES, cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        INPUT_BASE_STYLES,
        INPUT_FOCUS_STYLES,
        "dark:bg-input/30 flex field-sizing-content min-h-16 w-full px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
