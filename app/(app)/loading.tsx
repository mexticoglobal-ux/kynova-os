import { Skeleton } from "@/components/ui/Skeleton";

export default function AppLoading() {
  return (
    <div className="space-y-6" role="presentation">
      <Skeleton className="h-36 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
