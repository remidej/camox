import {
  Link as TanStackLink,
  Navigate as TanStackNavigate,
  useLocation as useTanStackLocation,
  useNavigate as useTanStackNavigate,
} from "@tanstack/react-router";
import type { LinkProps as TanStackLinkProps } from "@tanstack/react-router";
import * as React from "react";

import {
  type DraftScope,
  draftNamedBy,
  followUrl,
  DraftScopeContext,
  useOptionalDraftScope,
} from "../../lib/draft-scope";
import { localizedPath } from "../../lib/locale-path";
import { PageAlternatesContext, useViewLocale } from "../../lib/view-locale-context";

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

async function browserNavigate(
  { replace, to, source, draft }: NavigateOptions,
  draftScope: DraftScope | null,
): Promise<void> {
  if (typeof window === "undefined") return;

  const href = draftScope
    ? draftScope.hrefFor(toHref(to), { from: window.location.href, draft })
    : toHref(to);
  if (replace) {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
  if (draftScope) followUrl(draftScope, window.location.href);
  window.dispatchEvent(new CustomEvent("camox:navigation", { detail: { source } }));
}

function NavigationProvider({
  children,
  getLocation = getBrowserLocation,
  initialLocation,
  location: controlledLocation,
  navigate: controlledNavigate,
}: {
  children: React.ReactNode;
  getLocation?: () => LocationState;
  initialLocation?: LocationState;
  location?: LocationState;
  navigate?: (options: NavigateOptions) => Promise<void> | void;
}) {
  const [location, setLocation] = React.useState(initialLocation ?? getLocation);
  const draftScope = React.useContext(DraftScopeContext);
  const navigateInBrowser = React.useCallback(
    (options: NavigateOptions) => browserNavigate(options, draftScope),
    [draftScope],
  );
  const navigate = controlledNavigate ?? navigateInBrowser;

  React.useEffect(() => {
    if (controlledLocation) return;
    const updateLocation = (event: Event) => {
      // History traversal restores a URL naming the draft it was in.
      if (event.type === "popstate" && draftScope) followUrl(draftScope, window.location.href);
      setLocation({
        ...getLocation(),
        source:
          event.type === "camox:navigation"
            ? (event as CustomEvent<{ source?: NavigationSource }>).detail?.source
            : undefined,
      });
    };
    window.addEventListener("popstate", updateLocation);
    window.addEventListener("camox:navigation", updateLocation);
    // Starting or leaving a draft rewrites the URL in place.
    const unsubscribe = draftScope?.subscribe(({ move }) => {
      if (move !== "adopted") setLocation(getLocation());
    });
    return () => {
      window.removeEventListener("popstate", updateLocation);
      window.removeEventListener("camox:navigation", updateLocation);
      unsubscribe?.();
    };
  }, [getLocation, controlledLocation, draftScope]);

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
    const { scope: draftScope, draftId } = useOptionalDraftScope();
    if (!context) return <TanStackLink {...props} ref={ref} />;

    const { activeProps, children, onClick, target, to, ...rest } = props;
    // The href names the viewed draft too, so opening the link in a new tab keeps it. A target
    // naming a draft keeps its own.
    const path = toHref(String(to));
    const href =
      context.location.href && draftScope
        ? draftScope.hrefFor(path, {
            from: context.location.href,
            draft: draftNamedBy(path) ? undefined : draftId,
          })
        : path;
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

/**
 * A page in one locale, as a locale switcher links to it: the runtime's `AlternatePath`, its path
 * as `href`, labelled with the locale's name.
 */
export interface Alternate {
  /** The locale's tag, such as `de` or `pt-BR`. */
  locale: string;
  /** The page's path in that locale, under the locale's prefix. */
  href: string;
  /** The locale's name in its own language, such as `Deutsch`. */
  label: string;
}

/** The tag of the locale the page renders in, such as `de`. */
function useLocale(): string {
  return useViewLocale().locale.tag;
}

/** A locale's name in its own language (`Deutsch` for `de`), or its tag when it has none. */
function nativeLocaleName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * The current page in every locale it exists in, the current one included, to build a locale
 * switcher from. A locale the page was removed from isn't listed.
 */
function useAlternates(): Alternate[] {
  const alternates = React.useContext(PageAlternatesContext);
  const { locale } = useViewLocale();
  const pathname = useLocation({ select: (location) => location.pathname });
  return React.useMemo(
    () =>
      (alternates ?? [{ locale: locale.tag, path: pathname }]).map((alternate) => ({
        locale: alternate.locale,
        href: alternate.path,
        label: nativeLocaleName(alternate.locale),
      })),
    [alternates, locale.tag, pathname],
  );
}

/**
 * Keeps internal links in the current locale: the returned function adds the locale's prefix to
 * a root-relative path (`/articles` is `/de/articles` on a `de` page). Anything else, such as
 * `https://…`, `//…`, `#…` or `mailto:…`, is returned as is. Write paths without a prefix.
 */
function useLocalizedHref(): (href: string) => string {
  const { locale } = useViewLocale();
  return React.useCallback(
    (href: string) =>
      href.startsWith("/") && !href.startsWith("//") ? localizedPath(href, locale) : href,
    [locale],
  );
}

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
  useAlternates,
  useLocale,
  useLocalizedHref,
  useLocation,
  useNavigate,
};
