import { SkeletonPage } from "@/components/ui/Skeleton";

// Every platform screen is a large client bundle: this skeleton shows at once while it streams in.
export default function PlatformLoading() {
  return <SkeletonPage />;
}
