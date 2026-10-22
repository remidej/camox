import { Link } from "camox/navigation";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "rounded-control inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        solid: "bg-brand text-ink-on-brand hover:bg-brand/80",
        outline: "border-ink/15 bg-ink/5 text-ink shadow-xs hover:bg-ink/10",
        plain: "text-ink hover:bg-ink/5",
      },
      size: {
        sm: "h-8 gap-1 px-2.5",
        md: "h-9 gap-1.5 px-2.5",
        lg: "h-10 gap-1.5 px-3",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

/** A link field's render props (`to`) or a plain `href`: renders the Camox `Link`. */
type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "to" | "href"> &
  ({ to: string; href?: never } | { href: string; to?: never });

type NativeButtonProps = ComponentProps<"button"> & { to?: never; href?: never };

type ButtonProps = ButtonVariantProps & (ButtonLinkProps | NativeButtonProps);

/**
 * A link when given `href` (or a link field's props, which carry `to`), a <button> otherwise.
 * Spread a link field's render props straight onto it.
 */
function Button({ className, variant, size, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (props.to != null || props.href != null) {
    const { to, href, ...rest } = props as ButtonLinkProps;
    return <Link data-slot="button" {...rest} to={to ?? href} className={classes} />;
  }
  return (
    <button
      data-slot="button"
      type="button"
      {...(props as NativeButtonProps)}
      className={classes}
    />
  );
}

export { Button, buttonVariants };
