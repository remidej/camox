import { NavigationProvider } from "camox/navigation";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "./button";

const location = { hash: "", href: "http://localhost/", pathname: "/", search: "" };

function onPage(children: ReactNode) {
  return renderToStaticMarkup(
    <NavigationProvider initialLocation={location}>{children}</NavigationProvider>,
  );
}

describe("Button", () => {
  it("is a link to another site when given an absolute href", () => {
    const html = onPage(<Button href="https://app.camox.dev">Dashboard</Button>);
    expect(html).toMatch(/^<a[^>]*href="https:\/\/app\.camox\.dev"[^>]*>Dashboard<\/a>$/);
  });

  it("is a link when given a link field's props", () => {
    const html = onPage(<Button to="/pricing">Pricing</Button>);
    expect(html).toMatch(/^<a[^>]*href="\/pricing"[^>]*>Pricing<\/a>$/);
  });

  it("is a button otherwise", () => {
    const html = renderToStaticMarkup(<Button>Copy</Button>);
    expect(html).toMatch(/^<button[^>]*type="button"[^>]*>Copy<\/button>$/);
  });
});
