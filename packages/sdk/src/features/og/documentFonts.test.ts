import assert from "node:assert/strict";
import { test } from "node:test";

import { documentGoogleFonts } from "./documentFonts";

const stylesheet = (href: string) => ({ rel: "stylesheet" as const, href });

void test("a family with a weight range loads the variable font in both styles", () => {
  const fonts = documentGoogleFonts({
    link: [
      stylesheet(
        "https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,100..900;1,100..900&display=swap",
      ),
    ],
  });
  assert.deepEqual(fonts, [{ name: "Archivo", weight: "100..900", style: ["normal", "italic"] }]);
});

void test("a family with listed weights loads each of them", () => {
  const fonts = documentGoogleFonts({
    link: [
      stylesheet(
        "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,400;1,100;1,400&display=swap",
      ),
    ],
  });
  assert.deepEqual(fonts, [{ name: "Lato", weight: [100, 400], style: ["normal", "italic"] }]);
});

void test("every family of every Google Fonts link loads, in order", () => {
  const fonts = documentGoogleFonts({
    link: [
      stylesheet(
        "https://fonts.googleapis.com/css2?family=Open+Sans&family=Fraunces:opsz,wght@9..144,700",
      ),
      stylesheet("https://fonts.googleapis.com/css2?family=Inter:wght@400"),
    ],
  });
  assert.deepEqual(fonts, [
    { name: "Open Sans" },
    { name: "Fraunces", weight: [700], axes: { opsz: "9..144" } },
    { name: "Inter", weight: [400] },
  ]);
});

void test("links that load no Google Fonts stylesheet are ignored", () => {
  const fonts = documentGoogleFonts({
    link: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preload", as: "style", href: "https://fonts.googleapis.com/css2?family=Inter" },
      stylesheet("https://fonts.bunny.net/css?family=inter:400"),
      stylesheet("/fonts.css"),
    ],
  });
  assert.deepEqual(fonts, []);
  assert.deepEqual(documentGoogleFonts({}), []);
});
