import { Card } from '@/components/ui/Card'
import { LoadingRegion, Skeleton, SkeletonText } from '@/components/ui/Skeleton'

/**
 * One skeleton per page, shaped like that page.
 *
 * Not a generic grey block: the whole value of a skeleton is that the eye has
 * already found the column it was going to read by the time the numbers
 * arrive, and that the layout does not jump when they do. A placeholder of
 * the wrong shape is a spinner with extra steps.
 */

function HeaderSkeleton({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 sm:mb-8">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-8 w-52 max-w-full" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>
      {withAction && <Skeleton className="h-10 w-40" rounded="rounded-xl" />}
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="size-8" rounded="rounded-lg" />
      </div>
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-20" />
    </Card>
  )
}

function CampaignCardSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-44 max-w-full" />
          <div className="mt-2.5 flex gap-1.5">
            <Skeleton className="h-5 w-20" rounded="rounded-full" />
            <Skeleton className="h-5 w-24" rounded="rounded-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-24" rounded="rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-2 w-full" rounded="rounded-full" />
      <div className="mt-3 flex gap-6">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
    </Card>
  )
}

export function DashboardSkeleton() {
  return (
    <LoadingRegion label="Chargement du tableau de bord">
      <HeaderSkeleton />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-3 h-3 w-56 max-w-full" />
          <Skeleton className="mt-6 h-10 w-32" />
          <Skeleton className="mt-4 h-3 w-full" rounded="rounded-full" />
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </Card>

        <Card className="p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-3 w-64 max-w-full" />
          <div className="mt-5 space-y-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="size-9" rounded="rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-40 max-w-full" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-8 space-y-3">
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 2 }, (_, index) => (
          <CampaignCardSkeleton key={index} />
        ))}
      </div>
    </LoadingRegion>
  )
}

export function CampaignListSkeleton() {
  return (
    <LoadingRegion label="Chargement des campagnes">
      <HeaderSkeleton />

      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-full max-w-xs" rounded="rounded-xl" />
        <Skeleton className="h-10 w-36" rounded="rounded-xl" />
        <Skeleton className="h-10 w-36" rounded="rounded-xl" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
          <CampaignCardSkeleton key={index} />
        ))}
      </div>
    </LoadingRegion>
  )
}

export function EditorSkeleton() {
  return (
    <LoadingRegion label="Chargement de la campagne">
      <HeaderSkeleton />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
        <div className="space-y-4">
          <Card className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-10 w-full" rounded="rounded-xl" />
            <Skeleton className="mt-5 h-56 w-full" rounded="rounded-xl" />
          </Card>

          <Card className="p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-4 h-24 w-full" rounded="rounded-xl" />
          </Card>
        </div>

        <Card className="p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-5 h-72 w-full" rounded="rounded-xl" />
        </Card>
      </div>
    </LoadingRegion>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <LoadingRegion label="Chargement des données">
      <div className="overflow-hidden rounded-card border border-border">
        <div className="border-b border-border bg-surface-2 px-4 py-2.5">
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 w-28 max-sm:hidden" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}

export function HistorySkeleton() {
  return (
    <LoadingRegion label="Chargement de l’historique">
      <HeaderSkeleton />
      <Skeleton className="mb-4 h-9 w-full max-w-lg" rounded="rounded-xl" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-full max-w-xs" rounded="rounded-xl" />
        <Skeleton className="h-10 w-36" rounded="rounded-xl" />
      </div>
      <TableSkeleton rows={8} />
    </LoadingRegion>
  )
}

export function AccountSkeleton() {
  return (
    <LoadingRegion label="Chargement du compte">
      <HeaderSkeleton withAction={false} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-12" rounded="rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48 max-w-full" />
            </div>
          </div>
          <SkeletonText lines={2} className="mt-5" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-28" />
          <SkeletonText lines={3} className="mt-4" />
        </Card>
      </div>
    </LoadingRegion>
  )
}
