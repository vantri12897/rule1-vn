import { CardsSkeleton } from "@/components/ui/Skeleton";
export default function Loading() {
  return (
    <div>
      <div className="mb-6 h-9" />
      <CardsSkeleton />
    </div>
  );
}
