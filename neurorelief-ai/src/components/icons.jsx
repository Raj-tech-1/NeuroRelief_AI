// Consistent outline icon set (24x24, currentColor) used by the dashboard shell and Overview.
const paths = {
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  heart: <path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z" />,
  brain: <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4a3 3 0 0 0-3 0zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" />,
  stethoscope: <path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-1M20 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />,
  device: <><rect x="7" y="6" width="10" height="12" rx="3" /><path d="M9 6V3h6v3M9 18v3h6v-3" /></>,
  book: <path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14" />,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
  doc: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="1.5" /><path d="M21 16l-5-5-8 8" /></>,
  leaf: <path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14zM5 19c3-5 6-8 10-10" />,
  drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="m5 12 5 5L20 7" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.500-3.500" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.4c2 .8 3.5 2.6 3.5 5.6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z" /><path d="M12 8v5M12 16.5v.01" /></>,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  ban: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
  speaker: <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  retry: <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />,
  message: <><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /><path d="M9 12h.01M12 12h.01M15 12h.01" /></>,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  uterus: <path d="M12 21v-5M6 4c-2 0-3 1.500-3 3.500S4.500 11 7 11h2c1.500 0 2 1 3 1s1.500-1 3-1h2c2.500 0 4-1.500 4-3.500S20 4 18 4c-2 0-3 2-6 2S8 4 6 4z" />,
  stomach: <path d="M9 3c-1 4 3 4 5 7s1 7-3 8.500a4.500 4.500 0 0 1-5.500-4c0-3 2.500-3.500 2.500-6.500" />,
  head: <path d="M12 3a7 7 0 0 0-7 7c0 3 1.500 4.500 2 6v3h8v-3c.5-1.500 2-3 2-6a7 7 0 0 0-5-7zM12 7.500 10.500 11h3L12 14.500" />,
  battery: <><rect x="2" y="8" width="17" height="8" rx="2" /><path d="M21 11v2M6 12h3" /></>,
  spine: <path d="M12 3v18M9 6h6M9.500 10h5M9 14h6M9.500 18h5" />,
  moon: <path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z" />,
  dizzy: <path d="M12 12a2 2 0 1 1 2 2 4 4 0 1 1-4-4 6 6 0 1 1 6 6" />,
  face: <><circle cx="12" cy="12" r="9" /><path d="M9 9h.01M15 9h.01M12 13h.01M9.500 15.500h.01M14.500 15.500h.01" /></>,
  bowl: <path d="M4 12h16a8 8 0 0 1-16 0zM8 8c0-1.500 1-2 1-3.500M12 8c0-1.500 1-2 1-3.500M16 8c0-1.500 1-2 1-3.500" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 16V5M7 10l5-5 5 5M5 20h14" />,
  eye: <><path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3.500 3 3.500 15 0 18M12 3c-3.500 3-3.500 15 0 18" /></>,
}

export function Icon({ name, size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function LeafLogo({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="nr-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F472B6" />
          <stop offset="1" stopColor="#9D2F83" />
        </linearGradient>
      </defs>
      <path d="M32 6c7 7 10 14 10 21 0 8-4.5 14-10 14s-10-6-10-14c0-7 3-14 10-21z" fill="url(#nr-logo)" />
      <path d="M8 30c9-1 16 3 19 12-9 1-16-3-19-12z" fill="url(#nr-logo)" opacity=".85" />
      <path d="M56 30c-9-1-16 3-19 12 9 1 16-3 19-12z" fill="url(#nr-logo)" opacity=".85" />
      <path d="M32 44c0 6-1 10-1 14h2c0-4-1-8-1-14z" fill="#9D2F83" opacity=".6" />
    </svg>
  )
}
