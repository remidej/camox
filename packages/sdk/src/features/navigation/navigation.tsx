import {
  Link as TanStackLink,
  Navigate as TanStackNavigate,
  useLocation as useTanStackLocation,
  useNavigate as useTanStackNavigate,
} from "@tanstack/react-router";
import type { LinkProps as TanStackLinkProps } from "@tanstack/react-router";
import * as React from "react";

import { withDraftParam } from "./draftParam";

export type NavigationSource = "canvas";

export interface LocationState {
  hash: string;
  href: string;
  pathname: string;
  search: string;
  source?: NavigationSource;
}

export interface NavigateOptions {
  replace?: boolean;
  to: string;
  source?: NavigationSource;
  /**
   * Switch to this draft, or to Live with `null` (ADR 0011). Left out, the navigation keeps the
   * draft the URL names.
   */
  draft?: string | null;
}

interface NavigationContextValue {
  location: LocationState;
  navigate: (options: NavigateOptions) => Promise<void> | void;
}

export type LinkProps = TanStackLinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>;

const NavigationContext = React.createContext<NavigationContextValue | null>(null);

function getBrowserLocation(): LocationState {
  if (typeof window === "undefined") {
    return { hash: "", href: "", pathname: "/", search: "" };
  }

  return {
    hash: window.location.hash,
    href: window.location.href,
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

function toHref(to: string): string {
  if (to.startsWith("#")) return `${getBrowserLocation().pathname}${to}`;
  return to;
}

async function browserNavigate({ replace, to, source, draft }: NavigateOptions): Promise<void> {
  if (typeof window === "undefined") return;

  const href = withDraftParam(toHref(to), window.location.href, draft);
  if (replace) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
  window.dispatchEvent(new CustomEvent("camox:navigation", { detail: { source } }));
}

function NavigationProvider({
  children,
  getLocation = getBrowserLocation,
  initialLocation,
  location: controlledLocation,
  navigate = browserNavigate,
}: {
  children: React.ReactNode;
  getLocation?: () => LocationState;
  initialLocation?: LocationState;
  location?: LocationState;
  navigate?: (options: NavigateOptions) => Promise<void> | void;
}) {
  const [location, setLocation] = React.useState(initialLocation ?? getLocation);

  React.useEffect(() => {
    if (controlledLocation) return;
    const updateLocation = (event: Event) =>
      setLocation({
        ...getLocation(),
        source:
          event.type === "camox:navigation"
            ? (event as CustomEvent<{ source?: NavigationSource }>).detail?.source
            : undefined,
      });
    window.addEventListener("popstate", updateLocation);
    window.addEventListener("camox:navigation", updateLocation);
    return () => {
      window.removeEventListener("popstate", updateLocation);
      window.removeEventListener("camox:navigation", updateLocation);
    };
  }, [getLocation, controlledLocation]);

  const value = React.useMemo(
    () => ({ location: controlledLocation ?? location, navigate }),
    [controlledLocation, location, navigate],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

const noNavigation = () => {};

/**
 * Keeps the surrounding location, but turns navigation off while `disabled`.
 * It renders the same tree either way, so toggling it never remounts children.
 */
function NavigationDisabled({
  disabled,
  children,
}: {
  disabled: boolean;
  children: React.ReactNode;
}) {
  const parent = React.useContext(NavigationContext);
  const value = React.useMemo(
    () => (parent && disabled ? { ...parent, navigate: noNavigation } : parent),
    [parent, disabled],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

/**
 * Keeps the surrounding navigation, but reads `location` instead of the
 * surrounding one when given. It renders the same tree either way, so switching
 * never remounts children.
 */
function NavigationLocation({
  location,
  children,
}: {
  location?: LocationState;
  children: React.ReactNode;
}) {
  const parent = React.useContext(NavigationContext);
  const value = React.useMemo(
    () => (parent && location ? { ...parent, location } : parent),
    [parent, location],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

function useLocation<T = LocationState>(options?: { select?: (location: LocationState) => T }): T {
  const context = React.useContext(NavigationContext);
  if (context) {
    if (options?.select) return options.select(context.location);
    return context.location as T;
  }

  return useTanStackLocation(options as Parameters<typeof useTanStackLocation>[0]) as T;
}

function useNavigate(): NavigationContextValue["navigate"] {
  const context = React.useContext(NavigationContext);
  if (context) return context.navigate;
  return useTanStackNavigate();
}

const Link: React.ForwardRefExoticComponent<LinkProps & React.RefAttributes<HTMLAnchorElement>> =
  React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
    const context = React.useContext(NavigationContext);
    if (!context) return <TanStackLink {...props} ref={ref} />;

    const { activeProps, children, onClick, target, to, ...rest } = props;
    // The href names the current draft too, so opening the link in a new tab keeps it.
    const href = context.location.href
      ? withDraftParam(toHref(String(to)), context.location.href)
      : toHref(String(to));
    const isActive = context.location.pathname === new URL(href, "http://camox.local").pathname;
    const activeAnchorProps = (isActive ? activeProps : undefined) as
      | React.AnchorHTMLAttributes<HTMLAnchorElement>
      | undefined;
    const className = [rest.className, activeAnchorProps?.className].filter(Boolean).join(" ");

    return (
      <a
        {...rest}
        {...activeAnchorProps}
        ref={ref}
        href={href}
        target={target}
        className={className || undefined}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (props.download !== undefined) return;
          if (target && target !== "_self") return;
          if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
          if (event.button !== 0) return;

          event.preventDefault();
          void context.navigate({ to: href });
        }}
      >
        {children}
      </a>
    );
  });

function Navigate({ replace, to, source }: NavigateOptions) {
  const context = React.useContext(NavigationContext);
  if (!context) return <TanStackNavigate replace={replace} to={to} />;

  React.useEffect(() => {
    void context.navigate({ replace, to, source });
  }, [context, replace, to, source]);

  return null;
}

export {
  Link,
  Navigate,
  NavigationDisabled,
  NavigationLocation,
  NavigationProvider,
  useLocation,
  useNavigate,
};
