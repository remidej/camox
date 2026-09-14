import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";

import type { Layout } from "../../../core/createLayout";
import { routeSegments } from "../../../core/derivedRoutes";

export function DerivedLayoutDialog({
  layout,
  projectSlug,
  currentParams,
  onClose,
}: {
  layout: Layout;
  projectSlug: string;
  currentParams?: Record<string, string>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const id = React.useId();
  const storageKey = `camox:derived-preview:${projectSlug}:${layout._internal.id}`;
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    if (currentParams) return currentParams;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        return Object.fromEntries(
          Object.entries(saved).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
      }
    } catch {
      // Storage may be unavailable; previewing does not depend on it.
    }
    return {};
  });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const segments = routeSegments(layout._internal.id);
  const params = [
    ...new Set(
      segments.filter((segment) => segment.startsWith("$")).map((segment) => segment.slice(1)),
    ),
  ];
  const valid = params.every((param) => {
    const value = values[param]?.trim();
    return value && !value.includes("/") && value !== "." && value !== "..";
  });
  const path = `/${segments
    .map((segment) => {
      if (!segment.startsWith("$")) return encodeURIComponent(segment);
      const value = values[segment.slice(1)]?.trim();
      return value ? encodeURIComponent(value) : segment;
    })
    .join("/")}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || pending) return;
            try {
              sessionStorage.setItem(storageKey, JSON.stringify(values));
            } catch {
              // Storage may be unavailable.
            }
            setPending(true);
            setError(null);
            try {
              await navigate({ to: path });
              onClose();
            } catch {
              setError("Could not open this preview. Check the parameters and try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Preview {layout._internal.title}</DialogTitle>
            <DialogDescription>
              Enter the path parameters for the page you want to preview.
            </DialogDescription>
          </DialogHeader>
          {params.map((param) => (
            <div key={param} className="space-y-2">
              <Label htmlFor={`${id}-${param}`}>{param}</Label>
              <Input
                id={`${id}-${param}`}
                required
                value={values[param] ?? ""}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, [param]: event.target.value }))
                }
              />
            </div>
          ))}
          <p className="text-muted-foreground font-mono text-sm break-all">{path}</p>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? "Opening…" : "Open preview"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
