import type { ComponentProps } from "react";

import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

type BlockContainerProps = Omit<ComponentProps<"section">, "ref">;

/**
 * Class for the double vertical border (desktop only) that runs continuously
 * down stacked blocks. Apply to any page-width element (a Container) that should
 * participate in that border — see also {@link BlockContainer}. The styles live
 * in `block-side-border` in `styles.css`.
 */
export const blockSideBorder = "block-side-border";

/**
 * Shared wrapper for page blocks: a dark Section with a bottom separator border, and a
 * Container carrying the section spacing and (on desktop) the double vertical border that
 * runs continuously between stacked blocks.
 */
export function BlockContainer({ className, children, ...props }: BlockContainerProps) {
  return (
    <Section {...props} scheme="dark" className={cn("border-b py-0", className)}>
      <Container className={cn("py-section", blockSideBorder)}>{children}</Container>
    </Section>
  );
}
