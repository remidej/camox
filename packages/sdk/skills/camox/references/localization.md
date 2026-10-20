# Localization in code

A project publishes in one or more locales, added and removed as content, never in code. The default locale's pages sit at unprefixed paths (`/pricing`); every other locale's sit under its lowercase tag (`/de/preise`). Camox translates everything in blocks and records, writes `<html lang>`, `hreflang` alternates and the combined sitemap itself. Code only has to keep text in blocks and links in the locale.

## Visible text lives in blocks

Every text a visitor can read is block content, layout blocks included: navbar and footer labels, a singleton's heading, a "Back to articles" link, a record page's "Written by". Camox translates block content; it never translates JSX. Put the text in a `layoutOnly` block placed in the layout's `before` or `after` slots, or in a field of the block that shows it. JSX keeps only structure, styling and data a loader returns.

## Internal links stay in the locale

Write root-relative paths without a locale prefix, and pass them through `useLocalizedHref` from `camox/navigation`. On a German page, `/articles` becomes `/de/articles`; on a default-locale page it stays `/articles`. External URLs, `#anchors` and `mailto:` links come back as is.

```tsx
import { Link, useLocalizedHref } from "camox/navigation";

function BackToArticles({ children }: { children: React.ReactNode }) {
  const localized = useLocalizedHref();
  return <Link to={localized("/articles")}>{children}</Link>;
}
```

Link fields and `camox:page:` text links already resolve per locale: render them as they come. The locale's prefix comes from the helper alone, so a `/de` written into code or content links German visitors to `/de/de/...` and English visitors to German.

## Language switcher

`useAlternates()` returns the current page in every locale it exists in, the current one included, as `{ locale, href, label }`. `label` is the locale's name in its own language (`Deutsch`, `français`), from `Intl.DisplayNames`; capitalize it with CSS if the design needs it. A locale the page was removed from isn't listed, so the switcher never links to a 404. `useLocale()` returns the current locale's tag, such as `de`.

```tsx
import { Link, useAlternates, useLocale } from "camox/navigation";

function LanguageSwitcher() {
  const current = useLocale();
  const alternates = useAlternates();
  if (alternates.length < 2) return null;
  return (
    <nav aria-label="Language">
      {alternates.map(({ locale, href, label }) => (
        <Link key={locale} to={href} hrefLang={locale} aria-current={locale === current}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

## Loaders

A singleton or derived layout's `loader` receives `locale`, the page's locale tag. Use it to fetch localized data when the data source has it. Camox renders what a loader returns as it is and never translates it. Route patterns aren't localized: `routes` lists the same paths for every locale, and `/de/pokemon/pikachu` renders the `pokemon.$name` layout in German.

```tsx
loader: async ({ params, locale }) => ({
  kind: "data",
  data: await loadPokemon(params.name, { language: locale }),
}),
```
