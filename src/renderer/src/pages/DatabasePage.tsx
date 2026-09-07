import type { DatabaseStatus } from '../../../shared/api'

interface DatabasePageProps {
  status: DatabaseStatus | undefined
  error: string
}

export function DatabasePage({ status, error }: DatabasePageProps) {
  const connected = status ? 'Connected' : error ? 'Connection error' : 'Connecting'

  return <>
    <div className="content-heading">
      <div>
        <p className="eyebrow">LOCAL STORAGE</p>
        <h2>Embedded database</h2>
      </div>
      <span className={`badge ${error ? 'error' : ''}`}>{connected}</span>
    </div>
    <p>Your spatial database is stored on this device.</p>
    {error && <p role="alert">{error}</p>}
    {status && <dl>
      <dt>Engine</dt><dd>PGlite + PostGIS</dd>
      <dt>Local storage</dt><dd>{status.path}</dd>
      <dt>Spatial query</dt><dd><code>{status.geometry}</code></dd>
      <dt>PostgreSQL</dt><dd>{status.version}</dd>
      <dt>PostGIS</dt><dd>{status.postgis}</dd>
    </dl>}
  </>
}
