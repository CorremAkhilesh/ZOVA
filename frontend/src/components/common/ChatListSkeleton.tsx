import { Skeleton } from '@/components/ui/skeleton';

/** Loading placeholder for the chat list (used while route chunks or data load). */
export function ChatListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1 p-3" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={index} className="flex items-center gap-3 px-2 py-2.5">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
