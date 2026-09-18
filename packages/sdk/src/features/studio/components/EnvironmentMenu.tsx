import { Alert, AlertDescription } from "@camox/ui/alert";
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
import { Badge } from "@camox/ui/badge";
import { Button } from "@camox/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { Separator } from "@camox/ui/separator";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, Download, Upload } from "lucide-react";
import * as React from "react";

import { AuthContext } from "@/lib/auth";
import {
  type CompatibilityReason,
  environmentMutations,
  environmentQueries,
  projectQueries,
} from "@/lib/queries";

const PRODUCTION_ENV = "production";

type Direction = "push" | "pull";

/**
 * Renders the first incompatibility reason as a single-sentence explanation.
 * Mirrors the framings used in the plan: "Cannot push because block type X
 * exists in dev but not in production. Deploy your code to production…".
 */
function formatReason(reason: CompatibilityReason, direction: Direction): string {
  const isPush = direction === "push";
  const sourceLabel = isPush ? "your dev environment" : "production";
  const targetLabel = isPush ? "production" : "your dev environment";
  const remedy = isPush
    ? "Deploy your code to production to register it, then try again."
    : "Run your dev project locally to register it, then try again.";

  switch (reason.kind) {
    case "block-definition-missing-in-source":
      return `Block type "${reason.blockId}" exists in ${targetLabel} but not in ${sourceLabel}.`;
    case "block-definition-missing-in-target":
      return `Block type "${reason.blockId}" exists in ${sourceLabel} but not in ${targetLabel}. ${remedy}`;
    case "block-definition-schema-mismatch":
      return `Block type "${reason.blockId}" has a different "${reason.field}" between envs. Sync block definitions and try again.`;
    case "layout-kind-mismatch":
      return `Layout "${reason.layoutId}" has a different kind between environments. Sync layout definitions and try again.`;
    case "layout-missing-in-source":
      return `Layout "${reason.layoutId}" exists in ${targetLabel} but not in ${sourceLabel}.`;
    case "layout-missing-in-target":
      return `Layout "${reason.layoutId}" exists in ${sourceLabel} but not in ${targetLabel}. ${remedy}`;
  }
}

export const EnvironmentMenu = () => {
  const [open, setOpen] = React.useState(false);
  const [pendingDirection, setPendingDirection] = React.useState<Direction | null>(null);
  const authCtx = React.useContext(AuthContext);
  const queryClient = useQueryClient();

  const projectQuery = useQuery({
    ...projectQueries.getBySlug(authCtx?.projectSlug ?? ""),
    enabled: !!authCtx?.projectSlug,
  });
  const projectId = projectQuery.data?.id;
  const environmentName = authCtx?.environmentName;

  const isProduction = environmentName === PRODUCTION_ENV;
  const canReplicate = !!projectId && !!environmentName && !isProduction;

  // One compatibility query per direction; both fire when the popover opens
  // and there's a non-prod env loaded. They share the
  // `queryKeys.environments.checkCompatibility` namespace so a successful
  // replicate (which broadcasts that key) invalidates both.
  const pushCheck = useQuery({
    ...environmentQueries.checkCompatibility(projectId ?? 0, environmentName ?? "", PRODUCTION_ENV),
    enabled: open && canReplicate,
  });
  const pullCheck = useQuery({
    ...environmentQueries.checkCompatibility(projectId ?? 0, PRODUCTION_ENV, environmentName ?? ""),
    enabled: open && canReplicate,
  });

  const replicate = useMutation({
    ...environmentMutations.replicate(),
    onSuccess: (data, variables) => {
      const isPushed = variables.targetEnvName === PRODUCTION_ENV;
      const verb = isPushed ? "Pushed to production" : "Pulled from production";
      const { pages, blocks, files } = data.copied;
      toast.success(`${verb} — ${pages} pages, ${blocks} blocks, ${files} files`);
      // The server broadcasts the same keys via the project room, but invalidating
      // locally avoids waiting on the debounced WebSocket round-trip.
      void queryClient.invalidateQueries({ queryKey: ["camox"] });
      setPendingDirection(null);
      setOpen(false);
    },
    onError: (error) => {
      console.error("Failed to replicate environment:", error);
      toast.error("Could not replicate environment");
      setPendingDirection(null);
    },
  });

  if (!authCtx?.environmentName) return null;

  const label = isProduction ? "PROD" : "DEV";
  const badgeClassName = isProduction
    ? "bg-green-100 text-green-800 border border-green-300 hover:bg-green-100 dark:bg-green-900 dark:text-green-300 dark:border-green-700 dark:hover:bg-green-900 font-mono text-xs"
    : "bg-yellow-100 text-yellow-800 border border-yellow-300 hover:bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300 dark:border-yellow-700 dark:hover:bg-yellow-900 font-mono text-xs";

  const handleConfirm = () => {
    if (!pendingDirection || !canReplicate || !environmentName || !projectId) return;
    const sourceEnvName = pendingDirection === "push" ? environmentName : PRODUCTION_ENV;
    const targetEnvName = pendingDirection === "push" ? PRODUCTION_ENV : environmentName;
    replicate.mutate({ projectId, sourceEnvName, targetEnvName });
  };

  const pushReason =
    pushCheck.data && !pushCheck.data.compatible ? pushCheck.data.reasons[0] : null;
  const pullReason =
    pullCheck.data && !pullCheck.data.compatible ? pullCheck.data.reasons[0] : null;
  const firstCompatibilityError = pushReason
    ? formatReason(pushReason, "push")
    : pullReason
      ? formatReason(pullReason, "pull")
      : null;

  const renderActionButton = (direction: Direction) => {
    const check = direction === "push" ? pushCheck : pullCheck;
    const checking = check.isLoading;
    const compatible = check.data?.compatible ?? false;
    const Icon = direction === "push" ? Upload : Download;
    const actionLabel = direction === "push" ? "Push to production" : "Pull from production";

    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        disabled={checking || !compatible || replicate.isPending}
        onClick={() => setPendingDirection(direction)}
      >
        {checking ? (
          <Spinner className="text-muted-foreground" />
        ) : (
          <Icon className="text-muted-foreground size-4" />
        )}
        <span>{actionLabel}</span>
      </Button>
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="ghost" className="gap-2" />}>
          <Badge variant="secondary" className={badgeClassName}>
            {label}
          </Badge>
          <ChevronDown className="shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="start" side="bottom">
          <div className="flex flex-col gap-3 py-4">
            {isProduction ? (
              <p className="px-4 text-sm">You are viewing the production environment.</p>
            ) : (
              <>
                <p className="px-4 text-sm">
                  This environment is your personal space to iterate on content and data structures.
                  It doesn't affect production data.
                </p>
                <Separator />
                <p className="text-muted-foreground px-4 text-xs font-medium">
                  Transfer data across environments
                </p>
                <div className="flex flex-col gap-2 px-4">
                  {renderActionButton("push")}
                  {renderActionButton("pull")}
                  {firstCompatibilityError ? (
                    <Alert variant="destructive" className="mt-1">
                      <AlertCircle className="size-4" />
                      <AlertDescription>{firstCompatibilityError}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={!!pendingDirection}
        onOpenChange={(o) => {
          if (!o && !replicate.isPending) setPendingDirection(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDirection === "push" ? "Push to production?" : "Pull from production?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDirection === "push" ? (
                <>
                  This will replace all content in{" "}
                  <span className="font-mono font-semibold">production</span> with the current{" "}
                  <span className="font-mono font-semibold">{environmentName}</span> environment.
                  This action cannot be undone.
                </>
              ) : (
                <>
                  This will replace all content in your{" "}
                  <span className="font-mono font-semibold">{environmentName}</span> environment
                  with <span className="font-mono font-semibold">production</span>. This action
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default" disabled={replicate.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirm}
              disabled={replicate.isPending}
            >
              {replicate.isPending ? <Spinner /> : null}
              {pendingDirection === "push" ? "Push" : "Pull"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
