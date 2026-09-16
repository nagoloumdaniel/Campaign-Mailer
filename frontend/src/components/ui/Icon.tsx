import type { ReactNode, SVGProps } from 'react'

/**
 * One icon family, drawn here rather than installed.
 *
 * Every glyph sits on the same 24 grid, with the same 1.75 stroke, round caps
 * and round joins. That consistency is the whole point: mixing two icon sets
 * is the single most visible way an interface reads as assembled rather than
 * designed, and it shows at a glance long before anyone can name why.
 *
 * Drawn rather than pulled from a package for three reasons. The bundle
 * carries only the dozen shapes actually used. Nothing has to be tree-shaken
 * correctly for that to be true. And a stroke that uses `currentColor`
 * inherits the theme with no configuration at all.
 *
 * An icon alone never carries a meaning: every icon-only control in this
 * application also carries an `aria-label` and, on a pointer, a tooltip.
 */

export type IconName =
  | 'home'
  | 'send'
  | 'history'
  | 'user'
  | 'users'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'mail'
  | 'clock'
  | 'calendar'
  | 'building'
  | 'upload'
  | 'download'
  | 'trash'
  | 'edit'
  | 'search'
  | 'filter'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'info'
  | 'paperclip'
  | 'plus'
  | 'close'
  | 'play'
  | 'pause'
  | 'logout'
  | 'lightbulb'
  | 'chart'
  | 'gauge'
  | 'eye'
  | 'inbox'
  | 'refresh'
  | 'file'
  | 'flag'
  | 'external'

/**
 * A Map rather than an object literal: the name is a typed union, but a Map
 * lookup never has to answer for `constructor` or `__proto__`, and the
 * question does not arise at all.
 */
const PATHS = new Map<IconName, ReactNode>([
  [
    'home',
    <path
      key="p"
      d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5h-7v5H5A1.5 1.5 0 0 1 3.5 19z"
    />,
  ],
  [
    'send',
    <path key="p" d="M20.5 3.5 10.75 13.25M20.5 3.5l-6.25 17-3.5-7.25L3.5 9.75z" />,
  ],
  [
    'history',
    <g key="p">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V10h5.5" />
      <path d="M12 7.75V12l3 1.75" />
    </g>,
  ],
  [
    'user',
    <g key="p">
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20.25a7.5 7.5 0 0 1 15 0" />
    </g>,
  ],
  [
    'users',
    <g key="p">
      <circle cx="9.5" cy="8.5" r="3.25" />
      <path d="M3 20a6.5 6.5 0 0 1 13 0M16.5 5.6a3.25 3.25 0 0 1 0 5.8M18 14.2a6.5 6.5 0 0 1 3 5.8" />
    </g>,
  ],
  [
    'settings',
    <g key="p">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.75 13 5.4l2.8-.7 1.5 2.6-1.9 2.1.9 2.6h2.9v3l-2.9.0-.9 2.6 1.9 2.1-1.5 2.6-2.8-.7-1 2.65h-3l-1-2.65-2.8.7-1.5-2.6 1.9-2.1-.9-2.6H2.8v-3h2.9l.9-2.6L4.7 7.3l1.5-2.6 2.8.7 1-2.65z" />
    </g>,
  ],
  [
    'sun',
    <g key="p">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </g>,
  ],
  ['moon', <path key="p" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />],
  [
    'monitor',
    <g key="p">
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </g>,
  ],
  [
    'mail',
    <g key="p">
      <rect x="2.75" y="5" width="18.5" height="14" rx="2.5" />
      <path d="m3.5 7 7.3 5.2a2 2 0 0 0 2.4 0L20.5 7" />
    </g>,
  ],
  [
    'clock',
    <g key="p">
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7v5.2l3.3 1.9" />
    </g>,
  ],
  [
    'calendar',
    <g key="p">
      <rect x="3.25" y="5" width="17.5" height="15.75" rx="2.5" />
      <path d="M3.25 10h17.5M8 3v4M16 3v4" />
    </g>,
  ],
  [
    'building',
    <g key="p">
      <path d="M4.5 20.75V5.5a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5v15.25M14.5 10h3.5a1.5 1.5 0 0 1 1.5 1.5v9.25M2.75 20.75h18.5" />
      <path d="M8 8h3M8 12h3M8 16h3" />
    </g>,
  ],
  [
    'upload',
    <path
      key="p"
      d="M12 15.5V3.75M8 7.5 12 3.5l4 4M3.75 15v3.75a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2V15"
    />,
  ],
  [
    'download',
    <path
      key="p"
      d="M12 3.75V15.5M8 11.5l4 4 4-4M3.75 15v3.75a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2V15"
    />,
  ],
  [
    'trash',
    <g key="p">
      <path d="M3.75 6.5h16.5M8.5 6.5V4.75a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V6.5" />
      <path d="M5.75 6.5 6.8 19.4a2 2 0 0 0 2 1.85h6.4a2 2 0 0 0 2-1.85L18.25 6.5" />
      <path d="M10.25 10.75v6M13.75 10.75v6" />
    </g>,
  ],
  [
    'edit',
    <path
      key="p"
      d="M4 20h4.2L20 8.2a2.4 2.4 0 0 0-3.4-3.4L4.8 16.6V20zM15 6.2l2.8 2.8"
    />,
  ],
  [
    'search',
    <g key="p">
      <circle cx="10.75" cy="10.75" r="6.75" />
      <path d="m15.75 15.75 4.5 4.5" />
    </g>,
  ],
  ['filter', <path key="p" d="M3.75 5.5h16.5l-6.4 7.6v6.1l-3.7 1.9v-8z" />],
  ['chevron-down', <path key="p" d="m6.5 9.5 5.5 5.5 5.5-5.5" />],
  ['chevron-left', <path key="p" d="M14.5 6.5 9 12l5.5 5.5" />],
  ['chevron-right', <path key="p" d="M9.5 6.5 15 12l-5.5 5.5" />],
  ['check', <path key="p" d="m4.5 12.5 5 5 10-11" />],
  [
    'check-circle',
    <g key="p">
      <circle cx="12" cy="12" r="8.75" />
      <path d="m8 12.25 2.75 2.75L16 9.5" />
    </g>,
  ],
  [
    'alert',
    <g key="p">
      <path d="M10.3 4.1 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.25M12 17.2h.01" />
    </g>,
  ],
  [
    'info',
    <g key="p">
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 11v5.25M12 7.8h.01" />
    </g>,
  ],
  [
    'paperclip',
    <path
      key="p"
      d="M20 11.5 12.2 19.3a4.6 4.6 0 0 1-6.5-6.5l7.9-7.9a3.1 3.1 0 0 1 4.4 4.4l-7.9 7.9a1.6 1.6 0 0 1-2.2-2.2l7.2-7.2"
    />,
  ],
  ['plus', <path key="p" d="M12 4.75v14.5M4.75 12h14.5" />],
  ['close', <path key="p" d="m6 6 12 12M18 6 6 18" />],
  [
    'play',
    <path
      key="p"
      d="M7.5 4.8v14.4a.8.8 0 0 0 1.22.68l11.3-7.2a.8.8 0 0 0 0-1.36L8.72 4.12A.8.8 0 0 0 7.5 4.8z"
    />,
  ],
  ['pause', <path key="p" d="M8.75 4.5v15M15.25 4.5v15" />],
  [
    'logout',
    <path
      key="p"
      d="M9.5 20.25H6a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2h3.5M15 8.25 18.75 12 15 15.75M18.25 12H9"
    />,
  ],
  [
    'lightbulb',
    <g key="p">
      <path d="M9 17.5a6.5 6.5 0 1 1 6 0v1.25a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M9.5 17.5h5" />
    </g>,
  ],
  ['chart', <path key="p" d="M3.5 20.5h17M7 20.5V12M12 20.5V5M17 20.5v-6" />],
  [
    'gauge',
    <g key="p">
      <path d="M3.5 17a8.5 8.5 0 1 1 17 0" />
      <path d="m12 17 4-6" />
    </g>,
  ],
  [
    'eye',
    <g key="p">
      <path d="M2.5 12S6 5.75 12 5.75 21.5 12 21.5 12 18 18.25 12 18.25 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </g>,
  ],
  [
    'inbox',
    <g key="p">
      <path d="M3.25 13.5h4.5l1.5 3h5.5l1.5-3h4.5" />
      <path d="M5.4 4.75h13.2a2 2 0 0 1 1.85 1.24l1.3 6.1v5.66a2 2 0 0 1-2 2H4.25a2 2 0 0 1-2-2v-5.66l1.3-6.1A2 2 0 0 1 5.4 4.75z" />
    </g>,
  ],
  ['refresh', <path key="p" d="M20.25 11.5a8.25 8.25 0 1 0-.9 4.5M20.5 4.5V11h-6.25" />],
  [
    'file',
    <g key="p">
      <path d="M13.5 3.25H7a2 2 0 0 0-2 2v13.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.75z" />
      <path d="M13.5 3.25v4.5a1 1 0 0 0 1 1H19" />
    </g>,
  ],
  ['flag', <path key="p" d="M5 21V4.25M5 4.75h10.5l-1.6 3.5 1.6 3.5H5" />],
  [
    'external',
    <path
      key="p"
      d="M14 4.25h5.75V10M19.25 4.75 11 13M17.25 14.5v4.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5H9.5"
    />,
  ],
])

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  /** In pixels. The stroke is scaled with it, so a 14px icon stays as light as a 24px one. */
  size?: number
}

export function Icon({ name, size = 18, className = '', ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default. A control that needs a name gets one on the
      // control, not on the picture inside it.
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {PATHS.get(name)}
    </svg>
  )
}
