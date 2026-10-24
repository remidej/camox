import { defineDocument } from "camox/document";

export default defineDocument({
  htmlAttrs: { lang: "en" },
  title: "{{projectName}}",
  meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  // The site's fonts: a Google Fonts stylesheet, whose families the Theme's font tokens name
  // (src/styles.css). On camox.site, Cloudflare Fonts serves them from the site's own origin.
  link: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap",
    },
  ],
});
