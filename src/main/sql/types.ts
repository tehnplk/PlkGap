

export interface ReferenceTable {
  name: string
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
}

export interface ReferenceData {
  source: string
  pulledAt: string
  excluded: string[]
  tables: ReferenceTable[]
}

export interface FileColumn {
  name: string
  type: string
  length: number | null
  nullable: boolean
  default: string | null
}

export interface FileTable {
  name: string
  columns: FileColumn[]
  primaryKey: string[]
  indexes: { name: string; unique: boolean; columns: string[] }[]
}

export interface FileStructure {
  source: string
  pulledAt: string
  tables: FileTable[]
}

/** Named as each startup phase begins, so a splash screen can say what is taking the time. */
export type SchemaPhase = (phase: string) => void

export interface BoundaryData {
  source: string
  pulledAt: string
  tolerance: string
  provinces: { changwat: string; nameTh: string; geom: unknown }[]
  districts: { changwat: string; ampur: string; nameTh: string; geom: unknown }[]
  subdistricts: { changwat: string; ampur: string; tambon: string; nameTh: string; geom: unknown }[]
}

export interface GeographyData {
  source: string
  pulledAt: string
  provinces: { changwat: string; nameTh: string; nameEn: string }[]
  districts: { changwat: string; ampur: string; code: string; nameTh: string; nameEn: string; postalCode: string }[]
  subdistricts: { changwat: string; ampur: string; tambon: string; code: string; nameTh: string; nameEn: string; postalCode: string }[]
}
