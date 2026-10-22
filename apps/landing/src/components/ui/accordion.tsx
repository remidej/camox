import { ChevronDownIcon } from "lucide-react";
import { createContext, use, useId, type ComponentProps } from "react";

import { cn } from "@/lib/utils";

/*
 * A native accordion: each item is a <details>, and items share one `name`, so the browser
 * keeps only one open at a time. It works without JS and ships none to visitors.
 */

const AccordionNameContext = createContext<string | undefined>(undefined);

function Accordion({ className, name, ...props }: ComponentProps<"div"> & { name?: string }) {
  const generatedName = useId();
  return (
    <AccordionNameContext value={name ?? generatedName}>
      <div data-slot="accordion" className={cn("flex w-full flex-col", className)} {...props} />
    </AccordionNameContext>
  );
}

function AccordionItem({ className, ...props }: ComponentProps<"details">) {
  const name = use(AccordionNameContext);
  return (
    <details
      data-slot="accordion-item"
      name={name}
      className={cn(
        "group/accordion-item not-last:border-b",
        // Opening animates only where browsers can animate <details> content natively.
        "[interpolate-size:allow-keywords] supports-[interpolate-size:allow-keywords]:details-content:h-0 supports-[interpolate-size:allow-keywords]:details-content:overflow-clip supports-[interpolate-size:allow-keywords]:details-content:transition-[height,content-visibility] supports-[interpolate-size:allow-keywords]:details-content:transition-discrete supports-[interpolate-size:allow-keywords]:open:details-content:h-auto motion-reduce:details-content:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: ComponentProps<"summary">) {
  return (
    <summary
      data-slot="accordion-trigger"
      className={cn(
        "rounded-control flex cursor-pointer list-none items-start justify-between gap-4 border border-transparent py-4 text-left text-sm font-medium hover:underline [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className="text-ink-muted pointer-events-none size-4 shrink-0 transition-transform group-open/accordion-item:rotate-180 motion-reduce:transition-none"
      />
    </summary>
  );
}

function AccordionContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="accordion-content"
      className={cn(
        "pt-0 pb-4 text-sm [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-ink [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
