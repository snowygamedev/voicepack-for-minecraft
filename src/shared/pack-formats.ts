/**
 * Minecraft `pack_format` numbers for resource packs.
 *
 * Mojang bumps this on almost every release, and a pack with the wrong number
 * shows up in-game as "incompatible". The table is data rather than logic so it
 * can be corrected without touching the builder, and the UI always allows a
 * manual numeric override for versions newer than this table.
 */
export interface PackFormatEntry {
  /** Value written to pack.mcmeta. */
  format: number
  /** Human label for the version range this format covers. */
  versions: string
  /** Lowest release in the range — used for sorting and "latest" detection. */
  since: string
}

export const PACK_FORMATS: readonly PackFormatEntry[] = [
  { format: 1, versions: '1.6.1 – 1.8.9', since: '1.6.1' },
  { format: 2, versions: '1.9 – 1.10.2', since: '1.9' },
  { format: 3, versions: '1.11 – 1.12.2', since: '1.11' },
  { format: 4, versions: '1.13 – 1.14.4', since: '1.13' },
  { format: 5, versions: '1.15 – 1.16.1', since: '1.15' },
  { format: 6, versions: '1.16.2 – 1.16.5', since: '1.16.2' },
  { format: 7, versions: '1.17 – 1.17.1', since: '1.17' },
  { format: 8, versions: '1.18 – 1.18.2', since: '1.18' },
  { format: 9, versions: '1.19 – 1.19.2', since: '1.19' },
  { format: 12, versions: '1.19.3', since: '1.19.3' },
  { format: 13, versions: '1.19.4', since: '1.19.4' },
  { format: 15, versions: '1.20 – 1.20.1', since: '1.20' },
  { format: 18, versions: '1.20.2', since: '1.20.2' },
  { format: 22, versions: '1.20.3 – 1.20.4', since: '1.20.3' },
  { format: 32, versions: '1.20.5 – 1.20.6', since: '1.20.5' },
  { format: 34, versions: '1.21 – 1.21.1', since: '1.21' },
  { format: 42, versions: '1.21.2 – 1.21.3', since: '1.21.2' },
  { format: 46, versions: '1.21.4', since: '1.21.4' },
  { format: 55, versions: '1.21.5', since: '1.21.5' }
] as const

/** Sensible default for a brand-new project. */
export const DEFAULT_PACK_FORMAT = 55

export function describePackFormat(format: number): string {
  return PACK_FORMATS.find((e) => e.format === format)?.versions ?? `custom (${format})`
}
