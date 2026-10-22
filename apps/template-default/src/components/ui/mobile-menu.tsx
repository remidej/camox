import { MenuIcon, XIcon } from "lucide-react";
import { useId, type ComponentProps, type MouseEvent } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MobileMenuProps = ComponentProps<"div"> & {
  /** Accessible name of the menu button. */
  label?: string;
  /** Classes for the wrapper holding the menu button and the list. */
  wrapperClassName?: string;
};

/** Once a visitor follows a link, close the menu. Editable links stay put for the editor. */
function closeOnLinkClick(event: MouseEvent<HTMLDivElement>) {
  const link = (event.target as Element).closest("a");
  const list = event.currentTarget;
  if (link && !link.isContentEditable && list.matches(":popover-open")) list.hidePopover();
}

/**
 * Collapses a navbar's links behind a menu button below the `md` breakpoint, with no JS.
 * Pass the links as children: they're rendered once, in a single list that is a popover on
 * small screens (opened by the button's `popovertarget`) and sits inline from `md` up, where
 * CSS overrides the popover's hidden state. Place it inside the navbar's Section so the open
 * menu follows the navbar's color scheme; the open menu drops down below the navbar height.
 * `className` styles the list, `wrapperClassName` the element around the button and the list.
 */
export function MobileMenu({
  label = "Menu",
  wrapperClassName,
  className,
  children,
  onClick,
  ...props
}: MobileMenuProps) {
  const id = useId();
  return (
    <div className={cn("group/mobile-menu flex items-center", wrapperClassName)}>
      <button
        type="button"
        popoverTarget={id}
        aria-label={label}
        className={cn(buttonVariants({ variant: "plain", size: "sm" }), "px-2 md:hidden")}
      >
        <MenuIcon className="size-5 group-has-[:popover-open]/mobile-menu:hidden" />
        <XIcon className="hidden size-5 group-has-[:popover-open]/mobile-menu:block" />
      </button>
      <div
        {...props}
        id={id}
        popover="auto"
        onClick={(event) => {
          onClick?.(event);
          closeOnLinkClick(event);
        }}
        className={cn(
          // Small screens: a panel dropping down below the navbar, in the navbar's color scheme.
          "bg-canvas text-ink top-navbar inset-x-0 bottom-auto m-0 w-full max-w-none flex-col gap-1 border-0 border-b px-gutter py-4",
          "open:flex [&_a]:py-2",
          // Wide screens: the list sits inline, whatever the popover's state.
          "md:static md:flex md:w-auto md:flex-row md:items-center md:gap-6 md:border-0 md:overflow-visible md:bg-transparent md:p-0 md:[&_a]:py-0",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
