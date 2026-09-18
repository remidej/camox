import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@camox/ui/tabs";
import { Link2 } from "lucide-react";
import * as React from "react";

import { getPageIdFromTextLinkTarget, isValidTextLinkTarget } from "@/core/lib/textLinks";
import { destinationTextLink } from "@/core/pageDestinations";
import { usePageDestinations } from "@/hooks/use-page-destinations";

interface TextLinkPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  text: string;
  target: string | null;
  onSave: (target: string, text: string) => void;
  onUnlink: () => void;
}

export function TextLinkPopover({
  open,
  onOpenChange,
  trigger,
  text,
  target,
  onSave,
  onUnlink,
}: TextLinkPopoverProps) {
  const [textValue, setTextValue] = React.useState(text);
  const [mode, setMode] = React.useState<"page" | "external">("page");
  const [pageValue, setPageValue] = React.useState("");
  const [urlValue, setUrlValue] = React.useState("");

  const pages = usePageDestinations();
  const isPageTarget =
    target != null &&
    (getPageIdFromTextLinkTarget(target) != null ||
      pages.some((page) => destinationTextLink(page) === target));

  const prepare = React.useCallback(() => {
    setTextValue(text);
    if (target && isPageTarget) {
      setMode("page");
      setPageValue(target);
      setUrlValue("");
      return;
    }

    setMode("external");
    setUrlValue(target ?? "");
    setPageValue("");
  }, [target, text, isPageTarget]);

  React.useEffect(() => {
    if (!open) return;
    prepare();
  }, [open, prepare]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (nextOpen) prepare();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextText = textValue.trim();
    if (!nextText) return;

    if (mode === "page") {
      if (!pageValue) return;
      onSave(pageValue, nextText);
      return;
    }

    const nextTarget = urlValue.trim();
    if (!isValidTextLinkTarget(nextTarget)) return;
    onSave(nextTarget, nextText);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger}>
        <Link2 />
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-3">
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="text-link-text">Text</Label>
            <Input
              id="text-link-text"
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Destination</Label>
            <Tabs value={mode} onValueChange={(nextMode) => setMode(nextMode as typeof mode)}>
              <TabsList className="w-full">
                <TabsTrigger value="page">Page</TabsTrigger>
                <TabsTrigger value="external">URL</TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === "page" ? (
              <select
                className="border-input bg-background text-foreground h-9 rounded-md border px-2 text-sm"
                value={pageValue}
                onChange={(event) => setPageValue(event.target.value)}
              >
                <option value="">
                  {pages && pages.length > 0 ? "Select a page" : "No pages found"}
                </option>
                {pages?.map((page) => (
                  <option key={page.key} value={destinationTextLink(page)}>
                    {page.title} ({page.fullPath})
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type="text"
                inputMode="url"
                placeholder="https:// or /path"
                value={urlValue}
                onChange={(event) => setUrlValue(event.target.value)}
              />
            )}
          </div>
          <div className="grid gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={
                !textValue.trim() ||
                (mode === "page" ? !pageValue : !/^https?:\/\//i.test(urlValue.trim()))
              }
            >
              Save
            </Button>
            {target && (
              <Button type="button" variant="outline" size="sm" onClick={onUnlink}>
                Unlink
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
