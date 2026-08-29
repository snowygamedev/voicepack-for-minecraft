/**
 * The `category` field in sounds.json decides which in-game volume slider a
 * sound obeys. Getting it wrong means the player's "Music" slider silences
 * their zombie noises, so we always write one explicitly.
 */
export const SOUND_CATEGORIES = [
  'master',
  'music',
  'record',
  'weather',
  'block',
  'hostile',
  'neutral',
  'player',
  'ambient',
  'voice'
] as const

export type SoundCategory = (typeof SOUND_CATEGORIES)[number]

/**
 * Best-guess category from an event id, used when the catalog doesn't tell us.
 * Order matters — first match wins.
 */
const RULES: ReadonlyArray<[RegExp, SoundCategory]> = [
  [/^music\./, 'music'],
  [/^music_disc\./, 'record'],
  [/^weather\./, 'weather'],
  [/^ambient\./, 'ambient'],
  [/^block\./, 'block'],
  [/^item\./, 'player'],
  [/^entity\.player\./, 'player'],
  [/^entity\.(zombie|skeleton|creeper|spider|enderman|witch|blaze|ghast|slime|magma_cube|guardian|shulker|phantom|drowned|husk|stray|pillager|vindicator|evoker|ravager|vex|hoglin|zoglin|piglin|warden|breeze|bogged|wither)/, 'hostile'],
  [/^entity\./, 'neutral'],
  [/^ui\./, 'master'],
  [/^intentionally_empty$/, 'master']
]

export function guessCategory(eventId: string): SoundCategory {
  for (const [pattern, category] of RULES) {
    if (pattern.test(eventId)) return category
  }
  return 'master'
}
