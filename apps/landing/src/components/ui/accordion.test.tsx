import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";

describe("Accordion", () => {
  it("opens one answer at a time without JS: native items sharing one name", () => {
    const html = renderToStaticMarkup(
      <Accordion>
        <AccordionItem>
          <AccordionTrigger>Is Camox free?</AccordionTrigger>
          <AccordionContent>Yes.</AccordionContent>
        </AccordionItem>
        <AccordionItem>
          <AccordionTrigger>Is Camox open-source?</AccordionTrigger>
          <AccordionContent>Yes, MIT.</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );

    const names = [...html.matchAll(/<details[^>]*\sname="([^"]+)"/g)].map(([, name]) => name);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(names[1]);
    expect(html).toMatch(/<summary[^>]*>Is Camox free\?/);
    expect(html).toMatch(/<summary[^>]*>Is Camox open-source\?/);
  });

  it("keeps separate accordions independent", () => {
    const html = renderToStaticMarkup(
      <>
        <Accordion>
          <AccordionItem>
            <AccordionTrigger>A</AccordionTrigger>
          </AccordionItem>
        </Accordion>
        <Accordion>
          <AccordionItem>
            <AccordionTrigger>B</AccordionTrigger>
          </AccordionItem>
        </Accordion>
      </>,
    );

    const names = [...html.matchAll(/<details[^>]*\sname="([^"]+)"/g)].map(([, name]) => name);
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
  });
});
