import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  center: [number, number] | null
  radius: number
  onCenter: (center: [number, number]) => void
  onRadius: (radius: number) => void
}

/** Two clicks define a circle; the parent retains the selection across tab changes. */
export function OutbreakRadiusMap(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const circle = useRef<L.Circle | null>(null)
  useEffect(() => {
    const element = container.current!
    const map = L.map(element, { center: latest.current.center ?? [16.8211, 100.2659], zoom: 13 })
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles &copy; Esri',
    })
    L.control.layers({ 'Street map': streets, Satellite: satellite }).addTo(map)
    const draw = (point: L.LatLngExpression, radius: number) => {
      if (!circle.current) circle.current = L.circle(point, { radius, color: '#7843b5', fillOpacity: 0.15, interactive: false }).addTo(map)
      else circle.current.setLatLng(point).setRadius(radius)
    }
    if (latest.current.center) draw(latest.current.center, latest.current.radius)
    let anchor: L.LatLng | null = null
    const distance = (point: L.LatLng) => Math.max(1, Math.min(50000, Math.round(anchor!.distanceTo(point))))
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (!anchor) {
        anchor = event.latlng
        latest.current.onCenter([anchor.lat, anchor.lng])
        draw(anchor, latest.current.radius)
      } else {
        const radius = distance(event.latlng)
        draw(anchor, radius)
        latest.current.onRadius(radius)
        anchor = null
      }
    })
    map.on('mousemove', (event: L.LeafletMouseEvent) => { if (anchor) draw(anchor, distance(event.latlng)) })
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(element)
    return () => { observer.disconnect(); map.remove(); circle.current = null }
  }, [])
  useEffect(() => {
    if (props.center) circle.current?.setLatLng(props.center).setRadius(props.radius)
  }, [props.center, props.radius])
  return <div ref={container} role="region" aria-label="แผนที่วาดรัศมีแจ้งระบาด" style={{ height: 360, width: '100%', marginTop: 12 }} />
}
