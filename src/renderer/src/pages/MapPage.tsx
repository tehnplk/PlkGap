import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerRetina from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerRetina, shadowUrl: markerShadow })
const center: L.LatLngTuple = [16.8211, 100.2659]

export function MapPage() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current!
    const map = L.map(element, { center, zoom: 13 })
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    })
    L.control.layers({ 'Street map': streets, Satellite: satellite }).addTo(map)
    L.marker(center).addTo(map).bindPopup('Phitsanulok')
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(element)
    return () => { observer.disconnect(); map.remove() }
  }, [])

  return <div className="map-canvas" ref={container} role="application" aria-label="Interactive map" />
}
