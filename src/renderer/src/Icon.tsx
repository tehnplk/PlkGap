export type IconName =
  | 'grid' | 'cascade' | 'tile' | 'close' | 'minimize' | 'maximize' | 'restore' | 'chevron'
  | 'folder' | 'upload' | 'structure' | 'book'
  | 'chart' | 'gauge' | 'money'
  | 'map' | 'home'
  | 'message' | 'send'
  | 'virus' | 'activity'
  | 'settings' | 'hospital' | 'link' | 'dashboard' | 'counter'
  | 'users' | 'list'
const paths: Record<IconName, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  cascade: 'M4 15H2V2h13v2 M8 19H6V6h13v2 M10 10h12v12H10z M10 14h12',
  tile: 'M3 4h18v16H3z M12 4v16 M3 8h18',
  close: 'm6 6 12 12 M18 6 6 18', minimize: 'M5 17h14', maximize: 'M4 4h16v16H4z',
  restore: 'M8 8V3h13v13h-5 M3 8h13v13H3z', chevron: 'm9 5 7 7-7 7',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  upload: 'M12 16V4 M8 8l4-4 4 4 M4 20h16',
  structure: 'M4 4h16v16H4z M4 9h16 M4 15h16 M10 9v11',
  book: 'M5 4a2 2 0 0 1 2-2h13v18H7a2 2 0 0 0-2 2z M9 7h7 M9 11h7',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M3 20h18',
  gauge: 'M4 18a9 9 0 1 1 16 0 M12 14l4-4',
  money: 'M3 6h18v12H3z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M6.5 9.5v.01 M17.5 14.5v.01',
  map: 'M9 4 3 6.5v13.5L9 17.5 15 20l6-2.5V4l-6 2.5L9 4Z M9 4v13.5 M15 6.5V20',
  home: 'm3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8',
  message: 'M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12Z',
  send: 'm21 3-8 19-3-8-8-3Z M21 3 10 14',
  virus: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M12 2v4 M12 18v4 M2 12h4 M18 12h4 M5 5l3 3 M16 16l3 3 M19 5l-3 3 M8 16l-3 3',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 8.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z',
  hospital: 'M4 21V8l8-5 8 5v13 M2 21h20 M12 10v6 M9 13h6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
  dashboard: 'M3 4h8v8H3z M13 4h8v5h-8z M13 13h8v7h-8z M3 16h8v4H3z',
  counter: 'M4 5h16v14H4z M8 5v14 M4 9h4 M4 13h4 M4 17h4 M12 9h5 M12 13h5',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-1a7 7 0 0 1 14 0v1 M17 3.5a4 4 0 0 1 0 7.7 M22 21v-1a5 5 0 0 0-3.5-4.8',
  list: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
