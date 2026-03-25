import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import siteCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => {
    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: "{{projectName}}",
        },
      ],
      links: [
        {
          rel: "stylesheet",
          href: siteCss,
        },
        {
          rel: "icon",
          href: "/favicon.ico",
        },
      ],
    };
  },

  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
