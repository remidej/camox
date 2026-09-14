import {
  Link as TanStackLink,
  Navigate as TanStackNavigate,
  useLocation as useTanStackLocation,
  useNavigate as useTanStackNavigate,
} from "@tanstack/react-router";
import type { LinkProps as TanStackLinkProps } from "@tanstack/react-router";
import * as React from "react";

interface LocationState {
  hash: string;
  href: string;
  pathname: string;
  search: string;
}

interface NavigateOptions {
  replace?: boolean;
  to: string;
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

async function browserNavigate({ replace, to }: NavigateOptions): Promise<void> {
  if (typeof window === "undefined") return;

  const href = toHref(to);
  if (replace) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
  window.dispatchEvent(new PopStateEvent("popstate"));
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
    const updateLocation = () => setLocation(getLocation());
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

function useLocation<T = LocationState>(options?: { select?: (location: LocationState) => T }): T {
  const context = React.useContext(NavigationContext);
  if (context) {
    if (options?.select) return options.select(context.location);
    return context.location as T;
  }

  return useTanStackLocation(options as Parameters<typeof useTanStackLocation>[0]) as T;
}

function useNavigate() {
  const context = React.useContext(NavigationContext);
  if (context) return context.navigate;
  return useTanStackNavigate();
}

const Link: React.ForwardRefExoticComponent<LinkProps & React.RefAttributes<HTMLAnchorElement>> =
  React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
    const context = React.useContext(NavigationContext);
    if (!context) return <TanStackLink {...props} ref={ref} />;

    const { activeProps, children, onClick, target, to, ...rest } = props;
    const href = toHref(String(to));
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

function Navigate({ replace, to }: NavigateOptions) {
  const context = React.useContext(NavigationContext);
  if (!context) return <TanStackNavigate replace={replace} to={to} />;

  React.useEffect(() => {
    void context.navigate({ replace, to });
  }, [context, replace, to]);

  return null;
}

export { Link, Navigate, NavigationProvider, useLocation, useNavigate };
