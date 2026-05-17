const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function loadShard(char) {
  const dictPath = path.join(__dirname, '..', 'dict', `${char}.json`)
  return JSON.parse(fs.readFileSync(dictPath, 'utf8'))
}

const oDict = loadShard('o')
const cDict = loadShard('c')
const hDict = loadShard('h')
const tDict = loadShard('t')
const mDict = loadShard('m')

function relationWords(relations = []) {
  return relations.map((relation) => `${relation.label}:${relation.word}`)
}

test('open family relation metadata stays correct', () => {
  assert.equal(oDict.open.display_word, 'open')
  assert.equal(oDict.open.parent_relation, null)
  assert.deepEqual(relationWords(oDict.open.child_relations), [
    '第三人称单数:opens',
    '过去式:opened',
    '过去分词:opened',
    '现在分词:opening',
  ])

  assert.equal(oDict.opening.display_word, 'opening')
  assert.equal(oDict.opening.parent_relation, null)
  assert.ok(relationWords(oDict.opening.child_relations).includes('复数:openings'))

  assert.equal(oDict.openings.display_word, 'opening')
  assert.deepEqual(oDict.openings.parent_relation, { word: 'opening', label: '原形' })

  assert.equal(oDict.opens.display_word, 'open')
  assert.deepEqual(oDict.opens.parent_relation, { word: 'open', label: '原形' })

  assert.equal(oDict.opened.display_word, 'open')
  assert.deepEqual(oDict.opened.parent_relation, { word: 'open', label: '原形' })
})

test('child family keeps irregular plurals attached to the standalone parent', () => {
  assert.equal(cDict.child.display_word, 'child')
  assert.equal(cDict.child.parent_relation, null)
  assert.ok(relationWords(cDict.child.child_relations).includes('复数:children'))

  assert.equal(cDict.children.display_word, 'child')
  assert.deepEqual(cDict.children.parent_relation, { word: 'child', label: '原形' })
})

test('tailor family preserves standalone middle entries', () => {
  assert.equal(tDict.tailor.display_word, 'tailor')
  assert.equal(tDict.tailor.parent_relation, null)
  assert.ok(relationWords(tDict.tailor.child_relations).includes('现在分词:tailoring'))

  assert.equal(tDict.tailoring.display_word, 'tailoring')
  assert.equal(tDict.tailoring.parent_relation, null)
  assert.deepEqual(relationWords(tDict.tailoring.child_relations), ['复数:tailorings'])

  assert.equal(tDict.tailorings.display_word, 'tailoring')
  assert.deepEqual(tDict.tailorings.parent_relation, { word: 'tailoring', label: '原形' })
})

test('take family keeps standalone irregular forms on their own entries', () => {
  assert.equal(tDict.take.display_word, 'take')
  assert.equal(tDict.take.parent_relation, null)
  assert.deepEqual(relationWords(tDict.take.child_relations), [
    '第三人称单数:takes',
    '过去式:took',
    '过去分词:taken',
    '现在分词:taking',
  ])

  assert.equal(tDict.takes.display_word, 'take')
  assert.deepEqual(tDict.takes.parent_relation, { word: 'take', label: '原形' })

  assert.equal(tDict.taking.display_word, 'take')
  assert.deepEqual(tDict.taking.parent_relation, { word: 'take', label: '原形' })

  assert.equal(tDict.taken.display_word, 'take')
  assert.deepEqual(tDict.taken.parent_relation, { word: 'take', label: '原形' })

  assert.equal(tDict.took.display_word, 'took')
  assert.equal(tDict.took.parent_relation, null)
})

test('man family does not override standalone plural entries', () => {
  assert.equal(mDict.man.display_word, 'man')
  assert.equal(mDict.man.parent_relation, null)
  assert.ok(relationWords(mDict.man.child_relations).includes('复数:men'))

  assert.equal(mDict.men.display_word, 'men')
  assert.equal(mDict.men.parent_relation, null)
})

test('non-verb non-noun inflections do not use 原形 or 复数 relation labels', () => {
  assert.equal(hDict.happy.display_word, 'happy')
  assert.equal(hDict.happy.parent_relation, null)
  assert.deepEqual(relationWords(hDict.happy.child_relations), [])

  assert.equal(hDict.happier.display_word, 'happy')
  assert.equal(hDict.happier.parent_relation, null)
  assert.deepEqual(relationWords(hDict.happier.child_relations), [])

  assert.equal(hDict.happiest.display_word, 'happy')
  assert.equal(hDict.happiest.parent_relation, null)
  assert.deepEqual(relationWords(hDict.happiest.child_relations), [])
})
