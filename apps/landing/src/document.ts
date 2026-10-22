import { defineDocument } from "camox/document";

export default defineDocument({
  htmlAttrs: { lang: "en", class: "dark" },
  bodyAttrs: { class: "dark" },
  title: "Camox",
  meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  link: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,100..900;1,100..900&display=swap",
    },
    { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
    { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  ],
});
