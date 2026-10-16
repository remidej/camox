/* -------------------------------------------------------------------------------------------------
 * PageLocationFieldset
 * Shared fieldset for parent page select and page path input.
 * Used by CreatePageModal and PageMetadataModal.
 * -----------------------------------------------------------------------------------------------*/

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@camox/ui/input-group";
import { Label } from "@camox/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@camox/ui/select";

import type { Page } from "@/lib/queries";

const NO_PARENT_VALUE = "__no_parent__";

type PageLocationFieldsetProps = {
  parentPageId: string | undefined;
  onParentPageIdChange: (value: string | undefined) => void;
  pathSegment: string;
  onPathSegmentChange: (value: string) => void;
  disabled?: boolean;
  pages: Page[] | undefined;
  /** Page ID to exclude from the parent page list (the page being edited). */
  excludePageId?: string;
  autoFocusPathSegment?: boolean;
};

const PageLocationFieldset = ({
  parentPageId,
  onParentPageIdChange,
  pathSegment,
  onPathSegmentChange,
  disabled,
  pages,
  excludePageId,
  autoFocusPathSegment,
}: PageLocationFieldsetProps) => {
  const getParentPath = () => {
    if (!pages || !parentPageId) return "/";
    const page = pages.find((p) => p.id === parentPageId);
    return page ? page.fullPath + "/" : "/";
  };

  const nonRootPages = pages?.filter((page) => page.id !== excludePageId && page.fullPath !== "/");
  const hasParentOptions = nonRootPages && nonRootPages.length > 0;

  return (
    <>
      <div className="space-y-2">
        <Label>
          Parent page <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Select
          value={parentPageId ?? ""}
          disabled={disabled || !hasParentOptions}
          onValueChange={(value) =>
            onParentPageIdChange(
              !value || ["", NO_PARENT_VALUE].includes(value) ? undefined : value,
            )
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="No parent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT_VALUE}>No parent</SelectItem>
            <SelectSeparator />
            {nonRootPages?.map((page) => (
              <SelectItem key={page.id} value={page.id}>
                <div className="flex flex-col items-start">
                  <span>{page.nickname}</span>
                  <span className="text-muted-foreground font-mono text-xs [[data-slot=select-value]_&]:hidden">
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
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText className="px-2">{getParentPath()}</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="pathSegment"
            value={pathSegment}
            disabled={disabled}
            onChange={(e) => onPathSegmentChange(e.target.value)}
            placeholder="e.g. pricing, about-us"
            autoFocus={autoFocusPathSegment}
          />
        </InputGroup>
        <p className="text-muted-foreground text-xs">
          Used to generate the page URL, along with the parent page.
        </p>
      </div>
    </>
  );
};

export { PageLocationFieldset };
