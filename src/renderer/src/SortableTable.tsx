import { Children, cloneElement, isValidElement, useState } from 'react'
import type { ReactNode, ReactElement, TableHTMLAttributes } from 'react'

type NodeProps = { children?: ReactNode; className?: string; 'data-sort-value'?: string | number; 'aria-sort'?: 'none' | 'ascending' | 'descending' }
const elements = (children: ReactNode) => Children.toArray(children).filter(isValidElement<NodeProps>)
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (isValidElement<NodeProps>(node)) return textOf(node.props.children)
  return Children.toArray(node).map(textOf).join('')
}
const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
function valueOf(cell?: ReactElement<NodeProps>): string | number {
  const raw = cell?.props['data-sort-value'] ?? textOf(cell?.props.children)
  if (typeof raw === 'number') return raw
  const value = raw.trim()
  const date = value.match(/^(\d{1,2})\s+(\S+)\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (date && months.includes(date[2])) {
    const year = Number(date[3]) + (date[3].length === 2 ? 2500 : 0)
    return Date.UTC(year - 543, months.indexOf(date[2]), Number(date[1]), Number(date[4] ?? 0), Number(date[5] ?? 0))
  }
  const number = value.replace(/,/g, '').replace(/%$/, '')
  if (/^-?\d+(\.\d+)?$/.test(number)) return Number(number)
  return value
}

/** Sort React rows without changing page data or moving DOM nodes outside React. */
export function SortableTable({ children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null)
  return <table {...props}>{elements(children).map((section) => {
    if (section.type === 'thead') return cloneElement(section, {}, elements(section.props.children).map((row) =>
      cloneElement(row, {}, elements(row.props.children).map((cell, column) => {
        const active = sort?.column === column
        const label = textOf(cell.props.children) || 'การทำงาน'
        return cloneElement(cell, {
          className: `${cell.props.className ?? ''}${active ? ' active-sort' : ''}`,
          'aria-sort': active ? (sort.descending ? 'descending' : 'ascending') : 'none',
        }, <button type="button" className="th-sort-button" onClick={() => setSort({ column, descending: active ? !sort.descending : false })}>
          {label}<span className="sort-indicator" aria-hidden="true" style={{ fontSize: 0 }}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d={active ? (sort.descending ? 'M2 4L6 8L10 4' : 'M2 8L6 4L10 8') : 'M3 4L6 1L9 4M3 8L6 11L9 8'} fill="none" stroke="currentColor" /></svg>
          </span>
        </button>)
      }))))
    if (section.type !== 'tbody' || !sort) return section
    const rows = elements(section.props.children).map((row, index) => ({ row, index, value: valueOf(elements(row.props.children)[sort.column]) }))
    rows.sort((a, b) => {
      const result = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : collator.compare(String(a.value), String(b.value))
      return (sort.descending ? -result : result) || a.index - b.index
    })
    return cloneElement(section, {}, rows.map(({ row }) => row))
  })}</table>
}
