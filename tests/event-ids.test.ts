import { describe, expect, it } from 'vitest'
import { parseEventIdList } from '../src/shared/event-ids'

describe('parseEventIdList', () => {
  it('reads one id per line', () => {
    const { ids, invalid } = parseEventIdList('entity.zombie.hurt\nblock.stone.break\n')
    expect(ids).toEqual(['entity.zombie.hurt', 'block.stone.break'])
    expect(invalid).toEqual([])
  })

  it('drops the minecraft namespace and normalises case', () => {
    const { ids } = parseEventIdList('minecraft:Entity.Pig.Ambient')
    expect(ids).toEqual(['entity.pig.ambient'])
  })

  it('survives the punctuation a paste drags along', () => {
    const { ids, invalid } = parseEventIdList(
      ['- entity.cow.hurt,', '  "entity.cat.purr"  ', '', '# a comment', '* ui.button.click;'].join(
        '\n'
      )
    )
    expect(ids).toEqual(['entity.cow.hurt', 'entity.cat.purr', 'ui.button.click'])
    expect(invalid).toEqual([])
  })

  it('picks the key out of a pasted sounds.json', () => {
    const { ids, invalid } = parseEventIdList(
      ['{', '  "entity.zombie.hurt": {', '    "category": "hostile"', '  }', '}'].join('\n')
    )
    expect(ids).toEqual(['entity.zombie.hurt'])
    expect(invalid).toEqual(['"category": "hostile"'])
  })

  it('de-duplicates while keeping the pasted order', () => {
    const { ids } = parseEventIdList('b.two\na.one\nminecraft:b.two\nb.two')
    expect(ids).toEqual(['b.two', 'a.one'])
  })

  it('reports lines it cannot read instead of dropping them', () => {
    const { ids, invalid } = parseEventIdList('entity.zombie.hurt\nthe zombie hurt sound\n!!!')
    expect(ids).toEqual(['entity.zombie.hurt'])
    expect(invalid).toEqual(['the zombie hurt sound', '!!!'])
  })
})
