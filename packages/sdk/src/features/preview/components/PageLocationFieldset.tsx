/* -------------------------------------------------------------------------------------------------
 * PageLocationFieldset
 * Shared fieldset for parent page select and page path input.
 * Used by CreatePageSheet and EditPageSheet.
 * -----------------------------------------------------------------------------------------------*/

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as ControlGroup from "@/components/ui/control-group";
import { InputBase, InputBaseAdornment } from "@/components/ui/input-base";
import { formatPathSegment } from "@/lib/utils";
import { Id, Doc } from "camox/_generated/dataModel";

const NO_PARENT_VALUE = "__no_parent__";

type PageLocationFieldsetProps = {
  parentPageId: Id<"pages"> | undefined;
  onParentPageIdChange: (value: Id<"pages"> | undefined) => void;
  pathSegment: string;
  onPathSegmentChange: (value: string) => void;
  disabled?: boolean;
  pages: Doc<"pages">[] | undefined;
  /** Page ID to exclude from the parent page list (the page being edited). */
  excludePageId?: Id<"pages">;
};

const PageLocationFieldset = ({
  parentPageId,
  onParentPageIdChange,
  pathSegment,
  onPathSegmentChange,
  disabled,
  pages,
  excludePageId,
}: PageLocationFieldsetProps) => {
  const getParentPath = () => {
    if (!pages || !parentPageId) return "/";
    const page = pages.find((p) => p._id === parentPageId);
    return page ? page.fullPath + "/" : "/";
  };

  return (
    <>
      <div className="space-y-2">
        <Label>
          Parent page <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Select
          value={parentPageId ?? ""}
          disabled={disabled}
          onValueChange={(value) =>
            onParentPageIdChange(
              ["", NO_PARENT_VALUE].includes(value)
                ? undefined
                : (value as Id<"pages">),
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="No parent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT_VALUE}>No parent</SelectItem>
            <SelectSeparator />
            {pages
              ?.filter(
                (page) => page._id !== excludePageId && page.fullPath !== "/",
              )
              .map((page) => (
                <SelectItem key={page._id} value={page._id}>
                  <div className="flex flex-col items-start">
                    <span>
                      {page.metaTitle ?? formatPathSegment(page.pathSegment)}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono [[data-slot=select-value]_&]:hidden">
                      {page.fullPath}
                    </span>
                  </div>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Select a parent page to nest this page under it.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="pathSegment">Page path</Label>
        <ControlGroup.ControlGroup>
          <ControlGroup.ControlGroupItem className="shrink-0">
            <InputBase>
              <InputBaseAdornment>{getParentPath()}</InputBaseAdornment>
            </InputBase>
          </ControlGroup.ControlGroupItem>
          <ControlGroup.ControlGroupItem>
            <Input
              id="pathSegment"
              value={pathSegment}
              disabled={disabled}
              onChange={(e) => onPathSegmentChange(e.target.value)}
              placeholder="e.g. pricing, about-us"
            />
          </ControlGroup.ControlGroupItem>
        </ControlGroup.ControlGroup>
        <p className="text-muted-foreground text-xs">
          Used to generate the page URL, along with the parent page.
        </p>
      </div>
    </>
  );
};

export { PageLocationFieldset };
