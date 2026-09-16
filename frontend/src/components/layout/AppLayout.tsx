import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { Footer } from './Footer'
import { Navbar } from './Navbar'

/**
 * The frame every signed-in page renders inside.
 *
 * `min-h-dvh` with the main growing to fill it, so a short page still pushes
 * the footer to the bottom of the window rather than leaving it floating in
 * the middle — and so the dashboard can claim the whole height when it has
 * something to fill it with.
 *
 * `dvh` rather than `vh`: on a phone `vh` is measured against the viewport
 * with the address bar hidden, so a full-height page is always a little taller
 * than the screen and always scrolls by a few pixels for nothing.
 */
export function AppLayout() {
  const { pathname } = useLocation()

  // A router that swaps the page without moving the scroll leaves the reader
  // halfway down a page they have not seen the top of.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />

      <main
        id="main"
        // The key restarts the entry animation on each navigation, so a page
        // arrives rather than appearing fully formed in one frame.
        key={pathname}
        className="mx-auto w-full max-w-6xl flex-1 enter-fade px-4 pt-6 pb-12 sm:px-5 sm:pt-8"
      >
        <Outlet />
      </main>

      <Footer />
    </div>
  )
}
