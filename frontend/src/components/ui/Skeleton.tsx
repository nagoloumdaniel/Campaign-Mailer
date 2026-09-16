/**
 * The shape of what is coming, while it comes.
 *
 * Never a spinner. A spinner says "wait" and nothing else; a skeleton says
 * what will be there, so the eye has already found the column it was going to
 * read by the time the numbers arrive. The page also stops jumping, because
 * the placeholder occupies the height the content will.
 *
 * Every skeleton in this file is hidden from assistive technology and the
 * region that holds it carries the status instead: a screen reader should
 * hear "chargement", not eleven empty boxes.
 */

export function Skeleton({
  className = '',
  rounded = 'rounded-lg',
}: {
  className?: string
  rounded?: string
}) {
  return <span aria-hidden="true" className={`skeleton block ${rounded} ${className}`} />
}

/** A few lines of text, the last one short, as a paragraph really ends. */
export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number
  className?: string
}) {
  return (
    <span aria-hidden="true" className={`block space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={`h-3 ${index === lines - 1 ? 'w-2/5' : index % 2 === 0 ? 'w-full' : 'w-4/5'}`}
        />
      ))}
    </span>
  )
}

/** Wraps a loading region so the wait is announced once, in words. */
export function LoadingRegion({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
