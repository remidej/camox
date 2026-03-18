import { Skeleton } from "@camox/ui/skeleton";

export const AssetCardSkeleton = () => {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg p-2">
      <Skeleton className="aspect-4/3 w-full rounded-md" />
      <Skeleton className="mx-0.5 h-3.5 w-3/4" />
    </div>
  );
};
