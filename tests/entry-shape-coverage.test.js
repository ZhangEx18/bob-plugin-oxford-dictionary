const test = require("node:test")
const assert = require("node:assert/strict")
const { loadRuntime } = require("./_runtime")

// ---------------------------------------------------------------------------
// Entry-shape snapshot coverage.
//
// Every pack entry was grouped by its shape: entry kind, whether it carries its
// own definition text, whether display_word redirects or self-references,
// whether it expands into origin sources, relation kinds, and optional fields.
// That produced 45 shapes; the query-driven tests only ever named words from 25
// of them, leaving 20 shapes (463 entries) with no representative at all.
//
// Those 20 were exactly the blind spot that let a v8.5.0 regression ship: the 12
// entries of one shape silently stopped resolving offline and nothing failed.
// The "every router-acceptable entry is renderable" invariant now guards whether
// an entry resolves; these snapshots guard whether it renders correctly.
//
// Expectations were captured from the pack and verified byte for byte against the
// pre-refactor 8.4.2 artifact before being recorded. When the data legitimately
// changes, update the expectation in the same commit.
//
//   shape = kind | own text | redirect | origin expansion | origin edges
//           | inflections | xref | optional fields
//   count = how many entries share that shape
// ---------------------------------------------------------------------------

const SHAPE_CASES = [
  {"word":"acclimatizations","shape":"inflection|无文本|跳转|无展开|来源单|无派生|无xref|verbforms","count":229,"provider":"oald","parts":[{"part":"n.","means":["(使)习惯(新地方、新情况、新气候)；(使)服水土"]}],"exchanges":[{"name":"原形","words":["acclimatization"]}]},
  {"word":"accuses","shape":"inflection|有文本|跳转|无展开|来源单|无派生|无xref|verbforms|wordfamily","count":82,"provider":"oald","parts":[{"part":"v.","means":["控告；控诉；谴责"]}],"exchanges":[{"name":"原形","words":["accuse"]}]},
  {"word":"accused","shape":"inflection|有文本|跳转|来源展开|来源多|无派生|无xref|verbforms|wordfamily","count":43,"provider":"oald","parts":[{"part":"[accuse 的 过去式]","means":["控告；控诉；谴责"]},{"part":"[accuse 的 过去分词]","means":["控告；控诉；谴责"]}],"exchanges":[{"name":"原形","words":["accuse"]}]},
  {"word":"alderwomen","shape":"inflection|有文本|跳转|无展开|来源多|无派生|无xref","count":31,"provider":"oald","parts":[{"part":"n.","means":["高级市政官(职位低于市长),市政委员会委员"]}],"exchanges":[{"name":"原形","words":["alderman"]}]},
  {"word":"analyses","shape":"inflection|有文本|跳转|来源展开|来源多|无派生|无xref","count":25,"provider":"oald","parts":[{"part":"[analysis 的复数]","means":["(对事物的)分析,分析结果"]},{"part":"[analyse 的 第三人称单数]","means":["分析,对…进行精神分析(或治疗)","对…做心理分析(或治疗)"]}],"exchanges":[{"name":"原形","words":["analyse","analysis"]}]},
  {"word":"allied","shape":"standalone|有文本|自指|来源展开|来源多|无派生|无xref|wordfamily","count":14,"provider":"oald","parts":[{"part":"adj.","means":["结盟的,联盟的","协约国的","(两个或以上事物)类似的"]},{"part":"[ally 的 过去式]","means":["与…结盟"]},{"part":"[ally 的 过去分词]","means":["与…结盟"]}],"exchanges":[{"name":"原形","words":["ally"]}]},
  {"word":"have-to","shape":"standalone|有文本|自指|无展开|无来源|无派生|无xref|verbforms","count":7,"provider":"oald","parts":[{"part":"modal.","means":["必须,不得不"]}],"exchanges":[{"name":"第三人称单数","words":["has to"]},{"name":"过去式","words":["had to"]},{"name":"现在分词","words":["having to"]}]},
  {"word":"divisivenesses","shape":"inflection|无文本|跳转|无展开|来源单|无派生|无xref|wordfamily","count":6,"provider":"oald","parts":[{"part":"n.","means":["造成不和的；引起分歧的；制造分裂的"]}],"exchanges":[{"name":"原形","words":["divisiveness"]}]},
  {"word":"gee","shape":"standalone|有文本|自指|无展开|无来源|无派生|无xref|verbforms|phrasal","count":6,"provider":"oald","parts":[{"part":"int.","means":["(表示惊奇、感动或气恼)哇,啊,哎呀"]},{"part":" ","means":[" "]},{"part":"gee on","means":["v. 激励,鼓励(某人更努力、更好地工作等)"]},{"part":"gee up","means":["v. 激励,鼓励；催(马)前行；嘚"]}],"exchanges":[{"name":"第三人称单数","words":["gees"]},{"name":"过去式","words":["geed"]},{"name":"过去分词","words":["geed"]},{"name":"现在分词","words":["geeing"]}]},
  {"word":"explainers","shape":"inflection|无文本|跳转|无展开|来源单|无派生|无xref|verbforms|wordfamily","count":5,"provider":"oald","parts":[{"part":"n.","means":["解释者,讲解者","讲解的视频(或文章)"]}],"exchanges":[{"name":"原形","words":["explainer"]}]},
  {"word":"rent","shape":"standalone|有文本|自指|来源展开|来源多|派生|无xref|verbforms","count":3,"provider":"oald","parts":[{"part":"n.","means":["租金,破裂处","裂口"]},{"part":"v.","means":["租用,租借(房屋、土地等)","出租","以…出租"]},{"part":"[rend 的 过去式]","means":["撕开；撕碎"]},{"part":"[rend 的 过去分词]","means":["撕开；撕碎"]}],"exchanges":[{"name":"原形","words":["rend"]},{"name":"复数","words":["rents"]},{"name":"第三人称单数","words":["rents"]},{"name":"过去式","words":["rented"]},{"name":"过去分词","words":["rented"]},{"name":"现在分词","words":["renting"]}]},
  {"word":"balls","shape":"standalone|有文本|自指|来源展开|来源多|派生|无xref|verbforms|phrasal","count":2,"provider":"oald","parts":[{"part":"n.","means":["胡扯,勇气","睾丸"]},{"part":"[ball 的复数]","means":["球,球状物","踢出(或击出、投出)的一球","(投手投出的)坏球","大脚趾球","睾丸","(大型正式的)舞会"]},{"part":"[ball 的 第三人称单数]","means":["做成球状,使成团块","(和某人)性交"]},{"part":" ","means":[" "]},{"part":"balls up","means":["v. 把…搞糟；弄得一塌糊涂","n. 混乱；一团糟"]}],"exchanges":[{"name":"原形","words":["ball"]},{"name":"复数","words":["ballses"]},{"name":"第三人称单数","words":["ballses"]},{"name":"过去式","words":["ballsed"]},{"name":"过去分词","words":["ballsed"]},{"name":"现在分词","words":["ballsing"]}]},
  {"word":"inquire","shape":"standalone|有文本|自指|无展开|无来源|无派生|无xref|phrasal","count":2,"provider":"oald","parts":[{"part":"v.","means":["询问；打听"]},{"part":" ","means":[" "]},{"part":"inquire after","means":["v. 向某人问好(或问候)"]},{"part":"inquire into","means":["v. 调查；查究；查问"]}],"exchanges":[]},
  {"word":"proven","shape":"standalone|有文本|自指|无展开|来源单|派生|无xref|wordfamily","count":2,"provider":"oald","parts":[{"part":"adj.","means":["被证明的；已证实的"]},{"part":"v.","means":["prove 的过去分词"]}],"exchanges":[{"name":"原形","words":["prove"]},{"name":"现在分词","words":["proving"]}]},
  {"word":"could","shape":"standalone|有文本|自指|无展开|来源单|无派生|无xref|verbforms","count":1,"provider":"oald","parts":[{"part":"modal.","means":["能","可以","(表示可能性)可能","本来可以","(强调感觉)真想"]}],"exchanges":[{"name":"原形","words":["can"]}]},
  {"word":"lay","shape":"standalone|有文本|自指|无展开|来源单|派生|无xref|verbforms|phrasal","count":1,"provider":"oald","parts":[{"part":"v.","means":["放置,安放","(在某物上)摊开","铺","(鸟、昆虫、鱼等)下(蛋)","摆放餐具于(准备就餐)","提出","使处于特定状态(尤指困境)","周密准备","与(某人)性交","(摆好木、柴或煤)生火","对…下赌金"]},{"part":"adj.","means":["外行的,非专业的","平信徒的"]},{"part":"n.","means":["性交对象,(供吟唱的)叙事诗"]},{"part":" ","means":[" "]},{"part":"lay about","means":["v. 袭击(或猛打)某人"]},{"part":"lay about you","means":["v. 乱打；(向四面)拳打脚踢,猛打"]},{"part":"lay aside","means":["v. 把…放在一边(或搁置一旁),留存备用；留待以后处理"]},{"part":"lay down","means":["v. 放下,停止使用；中断(工作)；规定；积存"]},{"part":"lay in","means":["v. 贮备；贮存"]},{"part":"lay into","means":["v. 猛打；痛打；责骂；抨击"]},{"part":"lay off","means":["v. (让人停止做某事)行啦,就这样吧；停止使用；(因工作不多而)解雇","n. (因工作不多的)解雇,裁员；歇工期"]},{"part":"lay on","means":["v. 提供(尤指食物或娱乐),使不得不处理(讨厌或困难的事)"]},{"part":"lay out","means":["v. 把…打昏,(给死者)作殡葬准备；铺开；布置；清晰慎重地提出；花钱"]},{"part":"lay over","means":["v. (长途旅行在某处)中途停留"]},{"part":"lay up","means":["v. 贮备,贮存；(因病或受伤而)卧床歇工；自找(麻烦)；停止使用","n. (篮球)单手上篮,打点"]}],"exchanges":[{"name":"原形","words":["lie"]},{"name":"复数","words":["lays"]},{"name":"第三人称单数","words":["lays"]},{"name":"过去式","words":["laid"]},{"name":"过去分词","words":["laid","lain"]},{"name":"现在分词","words":["laying","lying"]}]},
  {"word":"os","shape":"standalone|有文本|自指|无展开|来源多|无派生|无xref","count":1,"provider":"oald","parts":[{"part":"abbr.","means":["操作系统,(英国)二等水兵"]}],"exchanges":[{"name":"原形","words":["o"]}]},
  {"word":"rose","shape":"standalone|有文本|自指|来源展开|无来源|派生|xref","count":1,"provider":"oald","parts":[{"part":"n.","means":["玫瑰(花),蔷薇(花)","粉红色","(水管或喷壶的)莲蓬式喷嘴","(天花板或顶棚的)灯线盒","玫瑰红葡萄酒"]},{"part":"adj.","means":["粉红色的；玫瑰色的"]},{"part":"v.","means":["rise 的过去式"]},{"part":"[rise 的 过去式]","means":["上升,攀升","(数量或数字)增加","升起","变得更加成功(或重要、强大等)","起床","(一群人)休会","提高","刮起来","增强","(因尴尬而)脸红","竖起","起义","耸立","凸起","发源","发酵","复活"]}],"exchanges":[{"name":"原形","words":["rise"]},{"name":"复数","words":["roses"]}]},
  {"word":"saw","shape":"standalone|有文本|自指|来源展开|无来源|派生|xref|verbforms|phrasal","count":1,"provider":"oald","parts":[{"part":"n.","means":["锯,谚语","格言"]},{"part":"v.","means":["锯,拉锯似的来回移动(某物)"]},{"part":"[see 的 过去式]","means":["看见,见到","看得见","观看","见","遇见","拜访","会见","与(某人)待在一起","理解","认为","设想","弄清","考虑","确保","经历","为…发生的时间","为…发生的地点","送"]},{"part":" ","means":[" "]},{"part":"saw down","means":["v. 锯倒"]},{"part":"saw off","means":["v. 锯掉；锯去"]},{"part":"saw up","means":["v. 把…锯成(小块或碎片)"]}],"exchanges":[{"name":"原形","words":["see"]},{"name":"复数","words":["saws"]},{"name":"第三人称单数","words":["saws"]},{"name":"过去式","words":["sawed"]},{"name":"过去分词","words":["sawn","sawed"]},{"name":"现在分词","words":["sawing"]}]},
  {"word":"sprung","shape":"standalone|有文本|自指|来源展开|来源多|无派生|xref","count":1,"provider":"oald","parts":[{"part":"adj.","means":["装有弹簧的；弹簧支撑的"]},{"part":"v.","means":["spring 的过去式和过去分词"]},{"part":"[spring 的 过去式]","means":["(人或动物)跳,跃","(物体)突然猛烈地移动","突如其来地做","突然出现(或来到)","帮助…逃跑(或越狱)"]},{"part":"[spring 的 过去分词]","means":["(人或动物)跳,跃","(物体)突然猛烈地移动","突如其来地做","突然出现(或来到)","帮助…逃跑(或越狱)"]}],"exchanges":[{"name":"原形","words":["spring"]}]},
]

test("entry shapes without query coverage render their recorded output", async () => {
  const runtime = await loadRuntime({ $httpMocks: [] })
  const query = (text) => new Promise((resolve, reject) => {
    runtime.translate({ text, detectFrom: "en", detectTo: "zh-Hans" }, (payload) => {
      if (payload.error) reject(new Error(text + " failed: " + payload.error.type))
      else resolve(payload.result)
    })
  })
  const normalize = (value) => JSON.parse(JSON.stringify(value))

  for (const shapeCase of SHAPE_CASES) {
    const { word, shape, provider, parts, exchanges } = shapeCase
    const at = word + ' [' + shape + ']'
    const result = await query(word)
    assert.equal(result.raw.provider, provider, at + " provider")
    assert.deepEqual(
      normalize(result.toDict.parts.map((p) => ({ part: p.part, means: p.means }))),
      parts,
      at + " parts",
    )
    assert.deepEqual(
      normalize(result.toDict.exchanges.map((e) => ({ name: e.name, words: e.words }))),
      exchanges,
      at + " exchanges",
    )
  }
})
