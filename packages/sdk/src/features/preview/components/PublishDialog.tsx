import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Label } from "@camox/ui/label";
import { Switch } from "@camox/ui/switch";
import * as React from "react";

import { getPublicationBlocker, type PublicationPlan } from "../publication";

/** Shared scope/impact review. Mount afresh for each publication attempt. */
export function PublishDialog({
  plan,
  pending,
  onPublish,
  onOpenChange,
  error,
  loading = false,
  unavailable = false,
  onSelectionChange,
}: {
  plan: PublicationPlan;
  pending: boolean;
  onPublish: (includedKeys: string[]) => void;
  onOpenChange: (open: boolean) => void;
  error?: string;
  loading?: boolean;
  unavailable?: boolean;
  onSelectionChange?: (key: string, included: boolean) => void;
}) {
  const id = React.useId();
  const [excludedKeys, setExcludedKeys] = React.useState<string[]>([]);
  const sideEffects = plan.items.filter((item) => item.optional);
  const includedKeys = plan.items
    .filter((item) => !item.optional || !excludedKeys.includes(item.key))
    .map((item) => item.key);
  const blocker = getPublicationBlocker(plan, includedKeys);

  return (
    <AlertDialog open onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <AlertDialogHeader>
          <AlertDialogTitle>{plan.title}</AlertDialogTitle>
          <AlertDialogDescription>{plan.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {sideEffects.length > 0 && (
          <div className="min-h-0 space-y-3 overflow-y-auto">
            {sideEffects.map((item) => (
              <div key={item.key} className="flex items-start gap-3">
                <Switch
                  id={`${id}-${item.key}`}
                  checked={!excludedKeys.includes(item.key)}
                  onCheckedChange={(checked) => {
                    setExcludedKeys((keys) =>
                      checked ? keys.filter((key) => key !== item.key) : [...keys, item.key],
                    );
                    onSelectionChange?.(item.key, checked);
                  }}
                  disabled={pending || loading}
                />
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`${id}-${item.key}`}>
                    {item.switchLabel ?? `Also publish ${item.label}`}
                  </Label>
                  <p className="text-muted-foreground text-sm">{item.impact}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {loading && (
          <p role="status" className="text-sm">
            Loading referenced items…
          </p>
        )}
        {(error || blocker) && (
          <p role="alert" className="text-destructive text-sm">
            {error || blocker}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || loading || unavailable || !!blocker || includedKeys.length === 0}
            onClick={(event) => {
              event.preventDefault();
              if (loading || unavailable || blocker) return;
              onPublish(includedKeys);
            }}
          >
            {pending ? "Publishing…" : "Publish"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
