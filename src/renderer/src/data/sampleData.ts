export interface SampleItem {
  id: number
  code: string
  name: string
  category: string
  latitude: number
  longitude: number
  elevation: number
  status: 'Active' | 'Verified' | 'Under Review' | 'Pending'
}

export const SAMPLE_DATA: SampleItem[] = [
  {
    id: 1,
    code: 'PLK-001',
    name: 'Wat Phra Si Rattana Mahathat',
    category: 'Temple',
    latitude: 16.8236,
    longitude: 100.2618,
    elevation: 45,
    status: 'Verified',
  },
  {
    id: 2,
    code: 'PLK-002',
    name: 'Chan Royal Palace',
    category: 'Heritage',
    latitude: 16.8285,
    longitude: 100.2598,
    elevation: 48,
    status: 'Verified',
  },
  {
    id: 3,
    code: 'PLK-003',
    name: 'Naresuan University',
    category: 'Education',
    latitude: 16.7431,
    longitude: 100.1937,
    elevation: 42,
    status: 'Active',
  },
  {
    id: 4,
    code: 'PLK-004',
    name: 'Phitsanulok Railway Station',
    category: 'Transit',
    latitude: 16.8173,
    longitude: 100.2662,
    elevation: 46,
    status: 'Active',
  },
  {
    id: 5,
    code: 'PLK-005',
    name: 'Thung Salaeng Luang National Park',
    category: 'Nature',
    latitude: 16.8403,
    longitude: 100.8752,
    elevation: 680,
    status: 'Active',
  },
  {
    id: 6,
    code: 'PLK-006',
    name: 'Phu Hin Rong Kla National Park',
    category: 'Nature',
    latitude: 17.0053,
    longitude: 101.0028,
    elevation: 1614,
    status: 'Verified',
  },
  {
    id: 7,
    code: 'PLK-007',
    name: 'Kaeng Sopha Waterfall',
    category: 'Nature',
    latitude: 16.8719,
    longitude: 100.8358,
    elevation: 220,
    status: 'Under Review',
  },
  {
    id: 8,
    code: 'PLK-008',
    name: 'Bueng Ratchanok Wetland',
    category: 'Park',
    latitude: 16.8115,
    longitude: 100.3245,
    elevation: 43,
    status: 'Pending',
  },
  {
    id: 9,
    code: 'PLK-009',
    name: 'Wat Nang Phaya',
    category: 'Temple',
    latitude: 16.8229,
    longitude: 100.2614,
    elevation: 45,
    status: 'Verified',
  },
  {
    id: 10,
    code: 'PLK-010',
    name: 'Nan River Promenade',
    category: 'Park',
    latitude: 16.8190,
    longitude: 100.2601,
    elevation: 44,
    status: 'Active',
  },
]

