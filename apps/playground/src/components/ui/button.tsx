import { Link } from "camox/navigation";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "rounded-control inline-flex shrink-0 items-center justify-center border border-transparent font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        solid: "bg-brand text-ink-on-brand hover:bg-brand/85",
        outline: "border-line text-ink hover:bg-ink/5",
        plain: "text-ink hover:bg-ink/5",
      },
      size: {
        sm: "h-8 gap-1 px-3 text-sm",
        md: "h-10 gap-1.5 px-4 text-sm",
        lg: "h-12 gap-2 px-6 text-base",
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
