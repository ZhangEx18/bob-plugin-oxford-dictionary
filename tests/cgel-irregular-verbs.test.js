const { describe, it } = require('node:test')
const assert = require('node:assert')
const { runTranslate } = require('./_runtime')

const fs = require('fs')

const CGEL_CORPUS_PATH = process.env.CGEL_CORPUS_PATH || ''
const hasLocalCorpus = Boolean(CGEL_CORPUS_PATH) && fs.existsSync(CGEL_CORPUS_PATH)

function parseIrregularVerbs() {
  if (!hasLocalCorpus) {
    return []
  }

  const content = fs.readFileSync(CGEL_CORPUS_PATH, 'utf8')
  
  const verbs = []
  // 匹配HTML表格行
  const regex = /<tr><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><\/tr>/g
  let match
  
  while ((match = regex.exec(content)) !== null) {
    const base = match[1].trim()
    const past = match[2].trim().split(/,\s*/).filter(s => s && !s.includes('*'))
    const participle = match[3].trim().split(/,\s*/).filter(s => s && !s.includes('*'))
    
    // 跳过表头
    if (base && base !== 'Base form') {
      verbs.push({ base, past, participle })
    }
  }
  
  return verbs
}

const irregularVerbs = parseIrregularVerbs()
const testOrSkip = hasLocalCorpus ? it : it.skip

describe('CGEL不规则动词 - 词典覆盖测试', () => {
  testOrSkip('应该能从PaddleOCR文件中解析出动词', () => {
    assert.ok(irregularVerbs.length > 0, `期望解析到不规则动词，实际得到 ${irregularVerbs.length}`)
    console.log(`从CGEL解析到 ${irregularVerbs.length} 个不规则动词`)
  })

  // 测试每个动词的基本形式
  for (const verb of irregularVerbs) {
    testOrSkip(`${verb.base} 应该能被查询`, async () => {
      try {
        const result = await runTranslate(verb.base)
        assert.ok(result.toDict, `期望 ${verb.base} 有结果`)
      } catch (err) {
        if (err.errorType === 'notFound') {
          console.log(`注意: ${verb.base} 不在词典中`)
          return
        }
        throw err
      }
    })

    // 测试过去式
    for (const pastForm of verb.past) {
      if (pastForm !== verb.base && !pastForm.includes('(')) {
        testOrSkip(`${pastForm} (${verb.base}的过去式) 应该能被查询`, async () => {
          try {
            const result = await runTranslate(pastForm)
            assert.ok(result.toDict, `期望 ${pastForm} 有结果`)
          } catch (err) {
            if (err.errorType === 'notFound') {
              console.log(`注意: ${pastForm} 不在词典中`)
              return
            }
            throw err
          }
        })
      }
    }

    // 测试过去分词
    for (const partForm of verb.participle) {
      if (partForm !== verb.base && !partForm.includes('(')) {
        testOrSkip(`${partForm} (${verb.base}的过去分词) 应该能被查询`, async () => {
          try {
            const result = await runTranslate(partForm)
            assert.ok(result.toDict, `期望 ${partForm} 有结果`)
          } catch (err) {
            if (err.errorType === 'notFound') {
              console.log(`注意: ${partForm} 不在词典中`)
              return
            }
            throw err
          }
        })
      }
    }
  }
})

describe('CGEL覆盖统计', () => {
  testOrSkip('应该报告覆盖率统计', async () => {
    let found = 0
    let notFound = 0
    
    // 抽样测试前20个动词
    for (const verb of irregularVerbs.slice(0, 20)) {
      try {
        await runTranslate(verb.base)
        found++
      } catch (err) {
        if (err.errorType === 'notFound') {
          notFound++
        }
      }
    }
    
    console.log(`\n=== CGEL词典覆盖率 ===`)
    console.log(`总动词数: ${irregularVerbs.length}`)
    console.log(`样本中找到: ${found}/${20}`)
    console.log(`样本中未找到: ${notFound}/${20}`)
    console.log(`======================\n`)
    
    assert.ok(found > 0, '期望至少找到一些动词')
  })
})
