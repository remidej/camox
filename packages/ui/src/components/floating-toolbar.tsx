import { cn } from "../lib/utils";

function FloatingToolbar({ className, ...props }: React.ComponentProps<"menu">) {
  return (
    <menu
      role="toolbar"
      data-slot="floating-toolbar"
      className={cn(
        "absolute left-[50%] z-30 flex translate-x-[-50%] items-center rounded-xl bg-background p-2 shadow-2xl inset-shadow-raised transition-all duration-200",
        className,
      )}
      {...props}
    />
  );
}

export { FloatingToolbar };
