import { Children, cloneElement, isValidElement, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, ReactElement, TableHTMLAttributes, PointerEvent } from 'react'

type NodeProps = { children?: ReactNode; className?: string; 'data-sort-value'?: string | number; 'aria-label'?: string; 'aria-sort'?: 'none' | 'ascending' | 'descending' }
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
type SortColumn = { column: number; descending: boolean }
type SortableTableProps = TableHTMLAttributes<HTMLTableElement> & { defaultSort?: SortColumn[]; maxVisibleRows?: number }
export function SortableTable({ children, defaultSort = [], maxVisibleRows, ...props }: SortableTableProps) {
  const [sorting, setSorting] = useState<SortColumn[]>(defaultSort)
  const tableRef = useRef<HTMLTableElement>(null)
  const [columnWidths, setColumnWidths] = useState<number[] | null>(null)
  const resizing = useRef<{ column: number; startX: number; widths: number[] } | null>(null)
  const headerCount = elements(elements(children).find((section) => section.type === 'thead')?.props.children)
    .flatMap((row) => elements(row.props.children)).length
  const widths = columnWidths?.length === headerCount ? columnWidths : null
  function measuredWidths() {
    return Array.from(tableRef.current?.tHead?.rows[0]?.cells ?? []).map((cell) => cell.getBoundingClientRect().width)
  }
  function startResize(event: PointerEvent<HTMLSpanElement>, column: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const measured = measuredWidths()
    resizing.current = { column, startX: event.clientX, widths: measured }
    setColumnWidths(measured)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveResize(event: PointerEvent<HTMLSpanElement>) {
    const drag = resizing.current
    if (!drag) return
    const next = [...drag.widths]
    next[drag.column] = Math.max(48, drag.widths[drag.column] + event.clientX - drag.startX)
    setColumnWidths(next)
  }
  function endResize(event: PointerEvent<HTMLSpanElement>) {
    resizing.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const [maxHeight, setMaxHeight] = useState<number>()
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table || !maxVisibleRows || maxVisibleRows < 1) return
    const measure = () => {
      const rows = table.tBodies[0]?.rows
      const lastVisible = rows?.[maxVisibleRows - 1]
      setMaxHeight(rows && rows.length > maxVisibleRows && lastVisible
        ? Math.ceil(lastVisible.getBoundingClientRect().bottom - table.getBoundingClientRect().top) : undefined)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    return () => observer.disconnect()
  }, [children, sorting, maxVisibleRows])
  const sort = sorting[0]
  const table = <table {...props} ref={tableRef}
    className={`${props.className ?? ''}${widths ? ' data-grid-resized' : ''}`}
    style={{ ...props.style, ...(widths ? { tableLayout: 'fixed', width: widths.reduce((sum, width) => sum + width, 0) } : {}) }}>
    {widths && <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>}
    {elements(children).map((section) => {
    if (section.type === 'thead') return cloneElement(section, {}, elements(section.props.children).map((row) =>
      cloneElement(row, {}, elements(row.props.children).map((cell, column) => {
        const active = sort?.column === column
        const label = textOf(cell.props.children) || 'การทำงาน'
        return cloneElement(cell, {
          className: `${cell.props.className ?? ''}${active ? ' active-sort' : ''}`,
          'aria-label': label,
          'aria-sort': active ? (sort.descending ? 'descending' : 'ascending') : 'none',
        }, <><button type="button" className="th-sort-button" onClick={() => setSorting([{ column, descending: active ? !sort.descending : false }])}>
          <span className="column-label">{label}</span><span className="sort-indicator" aria-hidden="true" style={{ fontSize: 0 }}>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d={active ? (sort.descending ? 'M2 4L6 8L10 4' : 'M2 8L6 4L10 8') : 'M3 4L6 1L9 4M3 8L6 11L9 8'} fill="none" stroke="currentColor" /></svg>
          </span>
        </button><span className="column-resize-handle" role="separator" aria-orientation="vertical"
          aria-label={`ปรับความกว้าง ${label}`} tabIndex={0} aria-valuemin={48}
          aria-valuenow={widths ? Math.round(widths[column]) : undefined}
          onPointerDown={(event) => startResize(event, column)} onPointerMove={moveResize}
          onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { resizing.current = null }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            event.stopPropagation()
            const next = measuredWidths()
            next[column] = Math.max(48, next[column] + (event.key === 'ArrowRight' ? 16 : -16))
            setColumnWidths(next)
          }} /></>)
      }))))
    if (section.type !== 'tbody' || !sort) return section
    const rows = elements(section.props.children).map((row, index) => ({ row, index, values: sorting.map(({ column }) => valueOf(elements(row.props.children)[column])) }))
    rows.sort((a, b) => {
      for (let index = 0; index < sorting.length; index++) {
        const left = a.values[index]
        const right = b.values[index]
        const result = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
        if (result) return sorting[index].descending ? -result : result
      }
      return a.index - b.index
    })
    return cloneElement(section, {}, rows.map(({ row }) => row))
  })}</table>
  return maxVisibleRows ? <div className="data-grid-scroll" style={{ maxHeight, overflow: 'auto' }}>{table}</div> : table
}
