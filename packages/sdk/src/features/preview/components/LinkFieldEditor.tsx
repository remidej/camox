import { Button } from "@camox/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@camox/ui/command";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { Switch } from "@camox/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";

import type { LinkValue } from "@/core/lib/contentType.ts";
import { destinationLink } from "@/core/pageDestinations";
import { useDebouncedField } from "@/hooks/use-debounced-field";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------------------------------
 * LinkFieldEditor
 * -----------------------------------------------------------------------------------------------*/

interface LinkFieldEditorProps {
  fieldName: string;
  linkValue: Record<string, unknown>;
  onSave: (fieldName: string, value: Record<string, unknown>) => void;
}

/** Normalize legacy links (no `type` field) into the union shape */
const normalizeLinkValue = (value: Record<string, unknown>): LinkValue => {
  if (!value.type) {
    return { type: "external", ...value } as LinkValue;
  }
  return value as LinkValue;
};

const LinkFieldEditor = ({ fieldName, linkValue: rawLinkValue, onSave }: LinkFieldEditorProps) => {
  const linkValue = normalizeLinkValue(rawLinkValue);

  const linkValueRef = React.useRef<LinkValue>(linkValue);
  React.useEffect(() => {
    linkValueRef.current = linkValue;
  }, [linkValue]);

  const textField = useDebouncedField(linkValue.text, (value: string) =>
    onSave(fieldName, { ...linkValueRef.current, text: value }),
  );
  const hrefField = useDebouncedField(
    linkValue.type === "external" ? linkValue.href : "",
    (value: string) => onSave(fieldName, { ...linkValueRef.current, href: value }),
  );

  const [pagePickerOpen, setPagePickerOpen] = React.useState(false);

  const pages = usePageDestinations();
  const selectedPage = pages.find((page) => {
    if (linkValue.type === "page")
      return page.kind === "curated" && String(page.pageId) === linkValue.pageId;
    return page.kind === "singleton" && page.fullPath === linkValue.href;
  });
  const mode = linkValue.type === "page" || selectedPage ? "page" : "external";

  const handleModeChange = (mode: string) => {
    if (mode === "page") {
      onSave(fieldName, {
        type: "page",
        text: linkValueRef.current.text,
        pageId: "",
        newTab: linkValueRef.current.newTab,
      });
    } else {
      onSave(fieldName, {
        type: "external",
        text: linkValueRef.current.text,
        href: "",
        newTab: linkValueRef.current.newTab,
      });
    }
  };

  const handlePageSelect = (key: string) => {
    const destination = pages.find((page) => page.key === key);
    if (!destination) return;
    onSave(fieldName, {
      ...destinationLink(destination),
      text: linkValueRef.current.text,
      newTab: linkValueRef.current.newTab,
    });
    setPagePickerOpen(false);
  };

  return (
    <form className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={`${fieldName}-text`}>Text</Label>
        <Input
          id={`${fieldName}-text`}
          value={textField.value}
          onChange={(e) => textField.setValue(e.target.value)}
          onFocus={textField.onFocus}
          onBlur={textField.onBlur}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Destination</Label>
        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList className="w-full">
            <TabsTrigger value="page">Page</TabsTrigger>
            <TabsTrigger value="external">URL</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "page" ? (
          <Popover open={pagePickerOpen} onOpenChange={setPagePickerOpen}>
            <PopoverTrigger
              render={
                <Button variant="outline" role="combobox" className="justify-between font-normal" />
              }
            >
              {selectedPage ? (
                <span className="truncate">{selectedPage.title}</span>
              ) : (
                <span className="text-muted-foreground">Select a page</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent align="start" className="p-0">
              <Command>
                <CommandInput placeholder="Search page..." className="h-9" />
                <CommandList>
                  <CommandEmpty>No page found.</CommandEmpty>
                  <CommandGroup>
                    {pages?.map((page) => (
                      <CommandItem
                        key={page.key}
                        value={page.fullPath}
                        keywords={[page.title]}
                        onSelect={() => handlePageSelect(page.key)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            selectedPage?.key === page.key ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{page.title}</span>
                          <span className="text-muted-foreground font-mono text-xs">
                            {page.fullPath}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <Input
            type="url"
            id={`${fieldName}-href`}
            placeholder="https://"
            value={hrefField.value}
            onChange={(e) => hrefField.setValue(e.target.value)}
            onFocus={hrefField.onFocus}
            onBlur={hrefField.onBlur}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${fieldName}-newtab`}
          checked={linkValue.newTab}
          onCheckedChange={(checked) => {
            onSave(fieldName, { ...linkValueRef.current, newTab: checked });
          }}
        />
        <Label htmlFor={`${fieldName}-newtab`}>Open in new tab</Label>
      </div>
    </form>
  );
};

export { LinkFieldEditor };
