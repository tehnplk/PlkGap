import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerRetina from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
})

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerRetina,
  shadowUrl: markerShadow,
})

L.Marker.prototype.options.icon = defaultIcon

interface Household { hid: string; village: string; members: number; lat: number; lng: number; surveyed: boolean }

const center: L.LatLngTuple = [16.8211, 100.2659]
const HOUSEHOLDS: Household[] = [
  { hid: '00001', village: 'หมู่ 1 บ้านคลองเตย', members: 4, lat: 16.8248, lng: 100.2611, surveyed: true },
  { hid: '00002', village: 'หมู่ 1 บ้านคลองเตย', members: 2, lat: 16.8231, lng: 100.2694, surveyed: true },
  { hid: '00003', village: 'หมู่ 2 บ้านท่าทอง', members: 5, lat: 16.8156, lng: 100.2582, surveyed: false },
  { hid: '00004', village: 'หมู่ 2 บ้านท่าทอง', members: 3, lat: 16.8123, lng: 100.2721, surveyed: true },
  { hid: '00005', village: 'หมู่ 3 บ้านหัวรอ', members: 6, lat: 16.8302, lng: 100.2748, surveyed: false },
  { hid: '00006', village: 'หมู่ 3 บ้านหัวรอ', members: 1, lat: 16.8355, lng: 100.2650, surveyed: true },
  { hid: '00007', village: 'หมู่ 4 บ้านวัดจันทร์', members: 4, lat: 16.8087, lng: 100.2640, surveyed: true },
  { hid: '00008', village: 'หมู่ 4 บ้านวัดจันทร์', members: 2, lat: 16.8064, lng: 100.2569, surveyed: false },
]

export function HouseholdMapPage() {
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

    const surveyed = L.layerGroup().addTo(map)
    const pending = L.layerGroup().addTo(map)
    for (const home of HOUSEHOLDS) {
      const popup = `<strong>HID ${home.hid}</strong><br />${home.village}<br />สมาชิก ${home.members} คน<br />${home.surveyed ? 'สำรวจแล้ว' : 'ยังไม่สำรวจ'}`
      L.marker([home.lat, home.lng], { icon: defaultIcon, title: `ครัวเรือน ${home.hid}` })
        .bindPopup(popup)
        .addTo(home.surveyed ? surveyed : pending)
      L.circleMarker([home.lat, home.lng], {
        radius: 9,
        weight: 2,
        color: home.surveyed ? '#187740' : '#b25e00',
        fillColor: home.surveyed ? '#37b06a' : '#e0a13c',
        fillOpacity: 0.35,
      }).addTo(home.surveyed ? surveyed : pending)
    }

    L.control.layers(
      { 'แผนที่ถนน': streets, 'ภาพดาวเทียม': satellite },
      { 'สำรวจแล้ว': surveyed, 'ยังไม่สำรวจ': pending },
      { collapsed: false },
    ).addTo(map)

    const legend = new L.Control({ position: 'bottomleft' })
    legend.onAdd = () => {
      const box = L.DomUtil.create('div', 'map-legend')
      box.innerHTML = `<strong>ตำแหน่งครัวเรือน (แฟ้ม Home)</strong>
        <span><i style="background:#37b06a;border-color:#187740"></i>สำรวจแล้ว ${HOUSEHOLDS.filter((home) => home.surveyed).length} ครัวเรือน</span>
        <span><i style="background:#e0a13c;border-color:#b25e00"></i>ยังไม่สำรวจ ${HOUSEHOLDS.filter((home) => !home.surveyed).length} ครัวเรือน</span>`
      return box
    }
    legend.addTo(map)

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(element)
    return () => { observer.disconnect(); map.remove() }
  }, [])

  return <div className="map-canvas" ref={container} role="application" aria-label="แผนที่ตำแหน่งครัวเรือน" />
}
