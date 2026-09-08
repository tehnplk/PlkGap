import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { BoundaryCollection, Household } from '../../../../shared/api'

/** A blue house, drawn inline so the marker needs no image file and no CDN. */
const houseIcon = L.divIcon({
  className: 'house-marker',
  html: `<svg viewBox="0 0 24 24" width="26" height="26" fill="#1f66d0" stroke="#0f3f8a" stroke-width="1.2"
    stroke-linejoin="round"><path d="M12 3 3 10.5V21h6v-6h6v6h6V10.5Z" /></svg>`,
  iconSize: [26, 26],
  iconAnchor: [13, 24],
  popupAnchor: [0, -22],
})

const center: L.LatLngTuple = [16.8211, 100.2659]

export function HouseholdMapPage() {
  const container = useRef<HTMLDivElement>(null)
  const [households, setHouseholds] = useState<Household[]>()
  const [areas, setAreas] = useState<{ district: BoundaryCollection; subdistrict: BoundaryCollection }>()
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      window.api.listHouseholds(),
      window.api.listBoundaries('district'),
      window.api.listBoundaries('subdistrict'),
    ])
      .then(([homes, district, subdistrict]) => { setHouseholds(homes); setAreas({ district, subdistrict }) })
      .catch((reason: unknown) => { setHouseholds([]); setError(String(reason)) })
  }, [])

  useEffect(() => {
    if (!households) return
    const element = container.current!
    const map = L.map(element, { center, zoom: 12 })
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    })

    // Thousands of houses would swamp the map, so they go in a cluster layer that opens on zoom.
    const cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 55 })
    for (const home of households) {
      const village = Number(home.village) || home.village
      const address = `${home.house || '-'} หมู่ที่ ${village || '-'}`
      L.marker([home.latitude, home.longitude], { icon: houseIcon, title: address })
        .bindPopup(`<strong>${address}</strong><br />ต.${home.tambonName || '-'} อ.${home.ampurName || '-'}`)
        .addTo(cluster)
    }
    map.addLayer(cluster)
    if (households.length) map.fitBounds(cluster.getBounds().pad(0.1))

    // Administrative outlines from the SUB-HDC PostGIS server, drawn under the households.
    const outline = (collection: BoundaryCollection, color: string, weight: number) =>
      L.geoJSON(collection as unknown as GeoJSON.GeoJsonObject, {
        style: { color, weight, fill: true, fillOpacity: 0.03, fillColor: color },
        onEachFeature: (feature, layer) => layer.bindTooltip(String(feature.properties?.name ?? ''), { sticky: true }),
      })
    const district = areas ? outline(areas.district, '#7843b5', 2) : L.layerGroup()
    const subdistrict = areas ? outline(areas.subdistrict, '#9c79bc', 1) : L.layerGroup()
    district.addTo(map)

    L.control.layers({ 'แผนที่ถนน': streets, 'ภาพดาวเทียม': satellite }, {
      'ขอบเขตอำเภอ': district,
      'ขอบเขตตำบล': subdistrict,
      'ครัวเรือน': cluster,
    }, { collapsed: false }).addTo(map)

    const legend = new L.Control({ position: 'bottomleft' })
    legend.onAdd = () => {
      const box = L.DomUtil.create('div', 'map-legend')
      box.innerHTML = `<strong>ตำแหน่งครัวเรือน (แฟ้ม Home)</strong>
        <span>${households.length.toLocaleString('en-US')} ครัวเรือนที่มีพิกัด</span>
        ${error ? `<span>${error}</span>` : ''}`
      return box
    }
    legend.addTo(map)

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(element)
    return () => { observer.disconnect(); map.remove() }
  }, [households, areas, error])

  return <div className="map-canvas" ref={container} role="application" aria-label="แผนที่ตำแหน่งครัวเรือน" />
}
