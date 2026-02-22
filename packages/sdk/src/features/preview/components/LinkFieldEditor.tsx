import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useQuery } from "convex/react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { api } from "camox/_generated/api";
import type { LinkValue } from "@/core/lib/contentType.ts";

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

const LinkFieldEditor = ({
  fieldName,
  linkValue: rawLinkValue,
  onSave,
}: LinkFieldEditorProps) => {
  const linkValue = normalizeLinkValue(rawLinkValue);

  const timerRef = React.useRef<number | null>(null);
  const [text, setText] = React.useState(linkValue.text);
  const [href, setHref] = React.useState(
    linkValue.type === "external" ? linkValue.href : "",
  );
  const linkValueRef = React.useRef<LinkValue>(linkValue);
  const [pagePickerOpen, setPagePickerOpen] = React.useState(false);

  const pages = useQuery(api.pages.listPages);

  const selectedPage =
    linkValue.type === "page"
      ? pages?.find((p) => p._id === linkValue.pageId)
      : null;

  React.useEffect(() => {
    linkValueRef.current = linkValue;
  }, [linkValue]);

  React.useEffect(() => {
    setText(linkValue.text);
  }, [linkValue.text]);

  React.useEffect(() => {
    if (linkValue.type === "external") {
      setHref(linkValue.href);
    }
  }, [linkValue]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleTextChange = (value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSave(fieldName, { ...linkValueRef.current, text: value });
    }, 500);
  };

  const handleHrefChange = (value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSave(fieldName, { ...linkValueRef.current, href: value });
    }, 500);
  };

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

  const handlePageSelect = (pageId: string) => {
    onSave(fieldName, {
      type: "page",
      text: linkValueRef.current.text,
      pageId,
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
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleTextChange(e.target.value);
          }}
          autoFocus
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Destination</Label>
        <Tabs value={linkValue.type} onValueChange={handleModeChange}>
          <TabsList className="w-full">
            <TabsTrigger value="page">Page</TabsTrigger>
            <TabsTrigger value="external">URL</TabsTrigger>
          </TabsList>
        </Tabs>
        {linkValue.type === "page" ? (
          <Popover open={pagePickerOpen} onOpenChange={setPagePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="justify-between font-normal"
              >
                {selectedPage ? (
                  <span className="truncate">{selectedPage.nickname}</span>
                ) : (
                  <span className="text-muted-foreground">Select a page</span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="p-0">
              <Command>
                <CommandInput placeholder="Search page..." className="h-9" />
                <CommandList>
                  <CommandEmpty>No page found.</CommandEmpty>
                  <CommandGroup>
                    {pages?.map((page) => (
                      <CommandItem
                        key={page._id}
                        value={page.fullPath}
                        onSelect={() => handlePageSelect(page._id)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            selectedPage?._id === page._id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{page.nickname}</span>
                          <span className="text-xs text-muted-foreground font-mono">
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
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              handleHrefChange(e.target.value);
            }}
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
