# Standard code catalog

PlkGap validates the 43 files against its own catalog, `src/main/reference/structure-codes.json`.
The `c_*` code lookups that ship inside `c-tables.json` are no longer used. Two sources build the
catalog, in this order:

1. **The published standard lists**, pulled by `scripts/pull-standard-codes.mjs` into
   `src/main/reference/standard-codes.json`. Most come from the Standard Code43 v2.4 set, but a
   list superseded in a later fiscal year is taken from its own newer version, so check for newer
   releases — not only that set — when refreshing.
2. **`c_files_schema.description`** — the enumerations the dictionary spells out itself, for fields
   no published file covers. A published list always wins; the dictionary paraphrase never overrides it.

`scripts/generate-structure-codes.mjs` merges the two and writes the catalog.
`loadStructureCodeTables()` seeds it under the `structure_codes` component, before the API views are
built. A digest prevents re-seeding unchanged data. These tables hold no user data, so a shape change
rebuilds them; imported 43-file rows are never touched.

## What still comes from the dictionary snapshot

`src/main/reference/tables-in-use.json` — the dictionary and file list (`c_files_schema`,
`c_files_desc`, `c_file`) and the service-unit registry (`c_hospital`, `c_hostype`). `c-tables.json`
still ships every table, but `loadReferenceTables()` seeds only these five and drops the rest, so a
database installed before the switch loses its stale lookups on the next start.

## Numbers

| | Tables | Rows |
|---|---|---|
| Published lists (41 files) | 42 | 4,451 |
| `c_files_schema.description` | 78 | 351 |
| **Catalog total** | **120** | **4,802** |
| Dictionary snapshot remnant | 5 | 1,146 |

132 dictionary fields get a code rule, against 118 before the switch. New coverage includes
`person.race`, `provider.prename`, `women.fptype`, `icf.icf`, `icf.qualifier`, `accident.aetype`,
`community_service.comservice`, `community_activity.comactivity`, the `refer_history` fields and
the `village` fields.

## Service-unit codes

A field holding a service-unit code must be all digits, the full width — 5 for `HOSPCODE` and its
kin, 9 for the `*9` variants. The rule (`unitcode`) runs after `width` and skips empty values, which
belong to `required`. Fields are recognised from the dictionary text itself: caption starting with
`รหัสหน่วยบริการ`/`หน่วยบริการ`, or description starting with `รหัสหน่วยบริการ`. That covers 161
fields — `hospcode`, `bhosp`, `hsub`, `main`, `sub`, `movefrom`, `hosp_source`, every `*place`, and
so on — while `clinic`, `ward*`, `drg` and `an*` are the same width but not unit codes, so they keep
the plain width rule.

## Decisions on record

- **ICF** ships one row per code plus qualifier (`b117.0` … `b117.9`), while the 43-file ICF keeps
  `ICF` and `QUALIFIER` in separate columns. `c_icf_icf` accepts **both** forms — the 43 condition
  codes, labelled with the wording their qualifier rows share, and the 301 published `code.qualifier`
  values — because real files use the combined form (every ICF row across the sample zips did) while
  the dictionary describes the split one. `c_icf_qualifier` holds the fixed 0–4/8/9 scale, and the
  pull fails if the spreadsheet ever uses a different scale.
- **CLINIC** is composed: service type, department, then a sub-clinic each hospital defines itself.
  `c_clinic_department` is deliberately absent from `bindings` so no whole `CLINIC` value is ever
  compared against it.
- **`labor.bplace`** states its codes in prose the parser cannot read, so they are transcribed from
  the same description text and marked `transcribed` in the audit. The description ends at a bare
  `5=`, so code 5 carries an explicit "not described" label.
- **`anc.ancno`** (which antenatal visit) and **`drugallergy.alevel`** (severity scale) get no code
  list by decision: the required and width rules alone apply, and where neither is defined the field
  is not checked.
- **`epi.vaccinetype` gets no width rule.** The dictionary declares C3 while the published list holds
  six-character HPV codes (`HPVC21` … `HPVG93`), so the width is the stale part. The field is judged
  by its list alone — not empty, and present in the list — and the code rule therefore sees every
  non-empty value, including long ones, so nothing escapes. It is the only field in this situation;
  the rule derives it from the catalog rather than naming the field.
- **Duplicate published codes** are recorded in `standard-codes.json` under `duplicates`; the first
  definition wins. `c_labfu_labtest` repeats `0450202` and `0482402`; the EPI sheets repeat
  `D21`–`D23` and `I11`–`I15` with identical names.
- **Shared lists** are one table with several bindings: `c_instype`, `c_chargeitem`, `c_servplace`,
  `c_diagtype`, `c_fptype`, `c_housetype`, `c_person_prename`, `c_person_nation`.
- **`c_person_prename`** carries `prename` and `sex` beside `code`/`description`, because the
  prename-versus-sex observation rule reads them.
- Still skipped, as `review`: `chronic.date_disch`, `person.ddischarge` (dates that mention another
  field's codes) and `newborn.asphyxia` (a 0–10 score plus sentinel 99).
- Drug codes (24-digit standard, dispensing units) and procedure codes are excluded for now at the
  user's request.

## Checked against real data

Fourteen real 52-file zips (2.9M rows, 5 hospitals) were imported into a temporary database and
checked. Every value the code rules rejected was compared with what the old lookups held:

- **No mass failure.** `epi.vaccinetype` — the risk that mattered — is written `010`/`073`/`084` in
  every file, the published three-digit form, not the old lookups' stripped `10`/`73`/`84`.
- **Almost every rejected value was already wrong.** `person.typearea` `9`, `death.pdeath` `3`,
  `newborn.bplace` `0`, `service.causein` `6`, `diagnosis_opd.diagtype` `z`, `provider.council` `พว`
  — all of these failed under the old lookups too.
- **New coverage found real errors** on fields that had no lookup before: `service.instype` `E1`/`G4`
  /`00`, `charge_opd.chargeitem` `00`, `village.wastewater` `2`, `person.race` `99` (two digits where
  the standard is three).
- **One behaviour change, kept on purpose.** `specialpp.ppspecial` codes withdrawn from the standard
  in Nov 2565 (`1B003`, `1B028`, `1B114`, `1B123`, `1B125`, `1B127`, `1B128`) used to pass, because
  the old lookups kept them as `is_active = 0` rows and the code rule ignores `is_active`. The published file
  lists only current codes, so they now fail — **a withdrawn code is an error, by decision**: it has
  a replacement (`1B003` → `1B0030`–`1B0034`) and the row should be corrected at the source. The
  code rule says so: `ไม่ตรงตามรหัสมาตรฐาน`.

The run also exposed a bug in the new `unitcode` rule: it did not skip values the `width` rule had
already rejected, so a nine-character code in a five-character field was counted twice. Every rule
after `required` now skips what an earlier one reported.

## Fiscal-year 2568 / 2569 refresh

Checked against the source page on 2026-09-09; three lists were behind and one was already current.

| List | Was | Now |
|---|---|---|
| `c_provider_council` | 62.รหัสสภาวิชาชีพ (2562), 7 codes | 04Nov68, 8 codes — adds `08 สภาการแพทย์แผนไทย` |
| `c_specialpp_ppspecial` | 15Sep68, 341 codes | Update Jun69, 382 codes — 41 added, none removed |
| `c_rehabilitation_at_device` | did not exist | 25Sep68, 536 codes for `rehabilitation.at_device` |
| `c_epi_vaccinetype` | 14.02.69 | byte-identical to the fiscal-year 2569 copy; unchanged |

The council update fixes a real finding: `08` appeared in imported PROVIDER rows and had no entry in
the 2562 file. The SpecialPP update does not revive the withdrawn codes — Jun69 still omits `1B003`,
`1B028`, `1B114`, `1B123`, `1B125`, `1B127` and `1B128`, which confirms they are meant to be errors.

## Regenerating

```
node scripts/pull-standard-codes.mjs      # re-read the published spreadsheets
node scripts/generate-structure-codes.mjs # rebuild the catalog from both sources
npx tsx scripts/test-database.ts
```

The pull fails loudly if a file, sheet or dictionary field disappears, if a table comes back empty,
or if two entries claim the same table name.
