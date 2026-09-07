import { useState } from 'react'
import { SAMPLE_DATA } from '../data/sampleData'
import type { SampleItem } from '../data/sampleData'

const columns: { key: keyof SampleItem; label: string; align?: 'right' | 'center' | 'left' }[] = [
  { key: 'id', label: 'ID', align: 'right' },
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'latitude', label: 'Latitude', align: 'right' },
  { key: 'longitude', label: 'Longitude', align: 'right' },
  { key: 'elevation', label: 'Elev. (m)', align: 'right' },
  { key: 'status', label: 'Status', align: 'center' },
]

export function TablePage() {
  const [data] = useState<SampleItem[]>(SAMPLE_DATA)
  const [sortKey, setSortKey] = useState<keyof SampleItem>('id')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(key: keyof SampleItem) {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const items = [...data].sort((a, b) => {
    const valA = a[sortKey]
    const valB = b[sortKey]
    const result = typeof valA === 'number' && typeof valB === 'number'
      ? valA - valB
      : String(valA).localeCompare(String(valB))
    return sortDir === 'asc' ? result : -result
  })
  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">GIS DATASET</p>
        <h2>Sample Data</h2>
      </div>
      <span className="badge">{items.length} records</span>
    </div>
    <p>Sample landmark and spatial observation points. Click any column header to sort ascending or descending.</p>
    <div className="table-wrapper">
      <table className="data-table" aria-label="Sample GIS Data Table">
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sortKey === col.key
              return (
                <th
                  key={col.key}
                  className={`col-${col.align ?? 'left'} ${active ? 'active-sort' : ''}`}
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="th-sort-button"
                    onClick={() => handleSort(col.key)}
                    aria-label={`Sort by ${col.label} (${active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'unsorted'})`}
                  >
                    <span>{col.label}</span>
                    <span className="sort-indicator" aria-hidden="true">
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td className="col-right num-cell">{row.id}</td>
              <td className="code-cell"><code>{row.code}</code></td>
              <td className="name-cell"><strong>{row.name}</strong></td>
              <td>{row.category}</td>
              <td className="col-right num-cell">{row.latitude.toFixed(4)}</td>
              <td className="col-right num-cell">{row.longitude.toFixed(4)}</td>
              <td className="col-right num-cell">{row.elevation.toLocaleString()}</td>
              <td className="col-center">
                <span className={`status-pill status-${row.status.toLowerCase().replace(/\s+/g, '-')}`}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
}

