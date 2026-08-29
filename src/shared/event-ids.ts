/**
 * Parsing for pasted lists of sound event ids.
 *
 * People collect these from all over — the wiki, a sounds.json, a spreadsheet,
 * a note on their phone — so the paste is rarely a clean list. We accept one id
 * per line, tolerate the punctuation those sources drag along, and report what
 * we could not make sense of instead of silently dropping it.
 */

/** Vanilla ids are lowercase dotted paths; namespaces use `:` and `/`. */
const VALID_ID = /^[a-z0-9_.\-/]*[a-z][a-z0-9_.\-/]*$/

/**
 * An event key from a pasted sounds.json, e.g. `"entity.pig.ambient": {`. The
 * trailing brace matters: it is what separates an event from the string-valued
 * keys nested inside one, like `"category": "neutral"`.
 */
const QUOTED_KEY = /^"([^"]+)"\s*:\s*\{/

export interface ParsedEventIds {
  /** Normalised ids, de-duplicated, in the order they were pasted. */
  ids: string[]
  /** Lines we could not read as an id, kept verbatim so the user can fix them. */
  invalid: string[]
}

/**
 * Turn one pasted line into an event id, or null if there is nothing usable on
 * it (blank lines, comments, stray JSON punctuation).
 */
function normaliseLine(line: string): string | null {
  let text = line.trim()
  if (!text) return null
  if (text.startsWith('#') || text.startsWith('//')) return null

  // A sounds.json paste: the id is the quoted key, the rest is structure.
  const quotedKey = QUOTED_KEY.exec(text)
  if (quotedKey?.[1]) text = quotedKey[1]

  // Bullets from markdown or a notes app.
  text = text.replace(/^[-*•]\s+/, '')
  // Surrounding quotes, and the trailing punctuation of a list item.
  text = text.replace(/^["']|["',;]+$/g, '')
  text = text.trim()
  if (!text || text === '{' || text === '}' || text === '[' || text === ']') return null

  // `minecraft:entity.pig.ambient` and `entity.pig.ambient` are the same event.
  const lowered = text.toLowerCase()
  return lowered.startsWith('minecraft:') ? lowered.slice('minecraft:'.length) : lowered
}

/**
 * Split a pasted block into event ids. Lines are the separator — commas are
 * not, because `sounds.json` keys never contain one but pasted prose often
 * does, and splitting on them turns one bad line into several.
 */
export function parseEventIdList(text: string): ParsedEventIds {
  const ids: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const line of text.split(/\r?\n/)) {
    const candidate = normaliseLine(line)
    if (candidate === null) continue
    if (!VALID_ID.test(candidate)) {
      invalid.push(line.trim())
      continue
    }
    if (seen.has(candidate)) continue
    seen.add(candidate)
    ids.push(candidate)
  }

  return { ids, invalid }
}
