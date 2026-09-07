export type IconName = 'grid' | 'home' | 'database' | 'cascade' | 'tile' | 'close' | 'minimize' | 'maximize' | 'restore' | 'arrow' | 'info'
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
  database: 'M20 6c0 2-3.6 3-8 3S4 8 4 6s3.6-3 8-3 8 1 8 3Z M4 6v12c0 2 3.6 3 8 3s8-1 8-3V6 M4 12c0 2 3.6 3 8 3s8-1 8-3',
  cascade: 'M4 15H2V2h13v2 M8 19H6V6h13v2 M10 10h12v12H10z M10 14h12',
  tile: 'M3 4h18v16H3z M12 4v16 M3 8h18',
  close: 'm6 6 12 12 M18 6 6 18', minimize: 'M5 17h14', maximize: 'M4 4h16v16H4z',
  restore: 'M8 8V3h13v13h-5 M3 8h13v13H3z', arrow: 'M4 12h16 m-6-6 6 6-6 6',
  info: 'M12 11v6 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
