import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";

import { cn } from "../lib/utils";

function Accordion({ ...props }: AccordionPrimitive.Root.Props) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ ...props }: AccordionPrimitive.Item.Props) {
  return <AccordionPrimitive.Item data-slot="accordion-item" {...props} />;
}

function AccordionHeader({ ...props }: AccordionPrimitive.Header.Props) {
  return <AccordionPrimitive.Header data-slot="accordion-header" {...props} />;
}

function AccordionTrigger({ ...props }: AccordionPrimitive.Trigger.Props) {
  return <AccordionPrimitive.Trigger data-slot="accordion-trigger" {...props} />;
}

/** Animates its height open and closed, from the height Base UI measures. */
function AccordionPanel({ className, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-panel"
      className={cn(
        "h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger };
