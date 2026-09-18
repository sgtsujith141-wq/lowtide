/** Small line icons drawn inline — no icon font, nothing fetched at runtime. */
const PATHS: Record<string, string> = {
  home: 'M4 11.2 12 4.5l8 6.7M6.2 9.8V19h11.6V9.8M10 19v-4.4h4V19',
  things: 'M4.5 7h11M4.5 12h11M4.5 17h7M19 6.6v.01M19 11.6v.01M19 16.6v.01',
  projects: 'M4 8.6 12 4.6l8 4v6.8l-8 4-8-4V8.6ZM4 8.6l8 4 8-4M12 12.6V19.4',
  return: 'M4.8 10.5a7.4 7.4 0 1 1 .7 5.4M4.6 5.6v5h5',
  moon: 'M19.2 14.4A7.6 7.6 0 0 1 9.6 4.8a7.6 7.6 0 1 0 9.6 9.6Z',
  archive: 'M4.5 7.5h15M6 7.5V19h12V7.5M4.5 7.5 6 4.8h12l1.5 2.7M10 12h4',
  plus: 'M12 5.5v13M5.5 12h13',
  clock: 'M12 6.8V12l3.2 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
}

export function Icon({
  name,
  className = 'size-[18px]',
}: {
  name: keyof typeof PATHS | string
  className?: string
}) {
  const d = PATHS[name] ?? PATHS.things
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  )
}
