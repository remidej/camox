import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export const Panel = ({
  children,
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"section"> & {
  asChild?: boolean;
}) => {
  const Comp = asChild ? Slot : "section";

  return (
    <Comp
      className={cn(
        "flex flex-col bg-background border-2 border-border shadow-xl rounded-lg overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  );
};

export const PanelHeader = ({
  children,
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"header"> & {
  asChild?: boolean;
}) => {
  const Comp = asChild ? Slot : "header";

  return (
    <Comp className={cn("p-4 border-b-2 border-border", className)} {...props}>
      {children}
    </Comp>
  );
};

export const PanelTitle = ({
  children,
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"h3"> & {
  asChild?: boolean;
}) => {
  const Comp = asChild ? Slot : "h3";

  return (
    <Comp
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    >
      {children}
    </Comp>
  );
};

export const PanelContent = ({
  children,
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"header"> & {
  asChild?: boolean;
}) => {
  const Comp = asChild ? Slot : "main";

  return (
    <Comp className={cn("grow overflow-auto", className)} {...props}>
      {children}
    </Comp>
  );
};
