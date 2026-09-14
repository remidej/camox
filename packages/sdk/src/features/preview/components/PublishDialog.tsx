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

import type { PublicationPlan } from "../publication";

/** Shared scope/impact review. Mount afresh for each publication attempt. */
export function PublishDialog({
  plan,
  pending,
  onPublish,
  onOpenChange,
}: {
  plan: PublicationPlan;
  pending: boolean;
  onPublish: (includedKeys: string[]) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const id = React.useId();
  const [excludedKeys, setExcludedKeys] = React.useState<string[]>([]);
  const sideEffects = plan.items.filter((item) => item.optional);
  const includedKeys = plan.items
    .filter((item) => !item.optional || !excludedKeys.includes(item.key))
    .map((item) => item.key);

  return (
    <AlertDialog open onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{plan.title}</AlertDialogTitle>
          <AlertDialogDescription>{plan.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {sideEffects.length > 0 && (
          <div className="space-y-3">
            {sideEffects.map((item) => (
              <div key={item.key} className="flex items-start gap-3">
                <Switch
                  id={`${id}-${item.key}`}
                  checked={!excludedKeys.includes(item.key)}
                  onCheckedChange={(checked) =>
                    setExcludedKeys((keys) =>
                      checked ? keys.filter((key) => key !== item.key) : [...keys, item.key],
                    )
                  }
                  disabled={pending}
                />
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`${id}-${item.key}`}>Also publish {item.label}</Label>
                  <p className="text-muted-foreground text-sm">{item.impact}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
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
