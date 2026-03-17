import { cn } from "@/lib/utils";

function FloatingToolbar({ className, ...props }: React.ComponentProps<"menu">) {
  return (
    <menu
      role="toolbar"
      data-slot="floating-toolbar"
      className={cn(
        "absolute left-[50%] z-30 flex translate-x-[-50%] items-center rounded-xl border-1 bg-background/95 p-2 shadow-2xl backdrop-blur-lg transition-all duration-200",
        className,
      )}
      {...props}
    />
  );
}

export { FloatingToolbar };
