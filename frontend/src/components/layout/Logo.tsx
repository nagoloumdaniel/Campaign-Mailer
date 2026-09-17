/**
 * The mark, as a drawing rather than as a picture file.
 *
 * It takes `currentColor`, so it is black on a light theme and white on a dark
 * one with nothing to switch, stays sharp at every size, and costs no request.
 * The raster versions it replaced were removed on 17 September 2026: one was
 * black on an opaque white square, the other white on white. The favicon in
 * `public/favicon.svg` draws the same paths.
 */
export function Logo({
  size = 28,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* The four fingers: two short, two long. */}
      <rect x="5.6" y="3.6" width="4.2" height="7.2" rx="1.7" />
      <rect x="10.6" y="3.6" width="4.2" height="7.2" rx="1.7" />
      <rect x="15.6" y="3.6" width="4.2" height="11.4" rx="1.7" />
      <rect x="20.6" y="3.6" width="4.2" height="11.4" rx="1.7" />
      {/* The palm, stepped under the long fingers, with the speech tail. */}
      <path d="M7.6 12.2H12.8a2 2 0 0 1 2 2v.4a1.8 1.8 0 0 0 1.8 1.8H24.4a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H18.8v5.4a.85.85 0 0 1-1.5.55L12.5 23.4H7.6a2 2 0 0 1-2-2V14.2a2 2 0 0 1 2-2Z" />
    </svg>
  )
}

/** The mark and the product name, as they appear in the navigation and the footer. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} />
      <span className="font-display text-[15px] font-semibold tracking-tight">
        Campaign Mailer
      </span>
    </span>
  )
}
