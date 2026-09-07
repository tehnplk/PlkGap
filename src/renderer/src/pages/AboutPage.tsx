import { Icon } from '../Icon'

export function AboutPage() {
  return <>
    <span className="about-logo"><Icon name="grid" size={28} /></span>
    <h2>PlkGap</h2>
    <p>A local desktop workspace.</p>
    <div className="about-details">
      Electron · React · Vite<br />
      Embedded PGlite + PostGIS
    </div>
  </>
}
