import { createContext, use, useId, type ComponentProps, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

/*
 * Native tabs: each tab is a <details> whose <summary> is its label, and the tabs share one
 * `name`, so the browser keeps one open at a time. Where browsers can style the <details>
 * content (`::details-content`), the labels line up in a row above the open panel; elsewhere
 * the tabs stack like an accordion, so every panel stays reachable. Labels are focusable and
 * open with Enter or Space. Pass `open` to the tab shown first (`open={index === 0}`).
 */

const TabsNameContext = createContext<string | undefined>(undefined);

function Tabs({ className, name, ...props }: ComponentProps<"div"> & { name?: string }) {
  const generatedName = useId();
  return (
    <TabsNameContext value={name ?? generatedName}>
      <div
        data-slot="tabs"
        className={cn(
          "flex w-full flex-col",
          // Where the labels can sit in a row: they wrap onto as many lines as they need.
          "supports-[selector(::details-content)]:flex-row supports-[selector(::details-content)]:flex-wrap supports-[selector(::details-content)]:gap-1",
          className,
        )}
        {...props}
      />
    </TabsNameContext>
  );
}

function TabsItem({ className, ...props }: ComponentProps<"details">) {
  const name = use(TabsNameContext);
  return (
    <details
      data-slot="tabs-item"
      name={name}
      className={cn(
        "group/tabs-item not-last:border-b",
        // In a row: the labels flow inline, and the open panel takes a full line below them.
        "supports-[selector(::details-content)]:contents supports-[selector(::details-content)]:details-content:order-1 supports-[selector(::details-content)]:details-content:basis-full supports-[selector(::details-content)]:details-content:pt-6 supports-[selector(::details-content)]:not-open:details-content:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** A tab stays open until another one opens, as tabs do, instead of closing on a second click. */
function keepOpen(event: MouseEvent<HTMLElement>) {
  if (event.currentTarget.parentElement?.hasAttribute("open")) event.preventDefault();
}

function TabsTrigger({ className, onClick, ...props }: ComponentProps<"summary">) {
  return (
    <summary
      data-slot="tabs-trigger"
      onClick={(event) => {
        onClick?.(event);
        keepOpen(event);
      }}
      className={cn(
        "rounded-control text-ink-muted hover:text-ink group-open/tabs-item:text-ink flex cursor-pointer list-none items-center py-4 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden",
        "supports-[selector(::details-content)]:px-4 supports-[selector(::details-content)]:py-2 supports-[selector(::details-content)]:group-open/tabs-item:bg-ink/5",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs-content"
      className={cn("pb-4 supports-[selector(::details-content)]:pb-0", className)}
      {...props}
    />
  );
}

export { Tabs, TabsItem, TabsTrigger, TabsContent };
