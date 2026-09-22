const updatedAt = "2026-09-17T00:00:00.000Z";
const ref = { sourceChapterId: "chapter-1", updatedAt };

export const demoNovels = [
  {
    id: "star-keeper",
    title: "长夜拾星人",
    genre: "玄幻",
    style: "细腻沉浸",
    cover: "stars",
    isDemo: true,
    status: "创作中",
    idea: "在失去星辰的永夜世界，一个修补旧物的少年，捡到了最后一颗活着的星星。",
    protagonist: "沈砚，十九岁，旧城修补匠。看似寡言，能听见旧物残留的记忆。",
    targetWords: 800000,
    targetChapters: 300,
    wordsPerChapter: 2700,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt,
    bible: {
      synopsis:
        "长夜降临的第七百年，修补匠沈砚在旧城废墟捡到了一颗仍在呼吸的星星。为找回被抹去的黎明，他与失忆的观星师踏上禁地。可每点亮一颗星辰，世间就会有一个人被永远遗忘。",
      conflict:
        "重燃星辰需要以人的存在为代价。沈砚必须在拯救世界与守护身边之人之间，寻找第三条路。",
      storyline:
        "从旧城拾星到追寻失落星图，穿越七座长夜之城，揭开永夜的起源，最终重写星辰与记忆的契约。",
      antagonist:
        "司夜者·白烬：守护永夜秩序的观星议会领袖，相信遗忘是人类免于灾难的唯一解药。",
      romance:
        "沈砚与观星师陆知微从互相试探到并肩同行；感情缓慢推进，与记忆和遗忘的主题相互呼应。",
    },
    outline: {
      master:
        "永夜七百年后，一名修补匠意外获得星核，发现自己能听见物品的记忆。他在废墟中寻找失落星图，与观星师陆知微结伴，渐渐发现长夜并非天灾，而是一场为了封存灾厄而立下的契约。\n\n全书以七座长夜之城为舞台。前期围绕旧城生存与能力觉醒，中期展开星图争夺和伙伴关系，后期揭开观星议会的真实动机。终局中，沈砚不再独自承担记忆，而是让所有人共同记住星辰，以此打破点星必有遗忘的规则。",
      volumes: [
        {
          id: "volume-1",
          title: "第一卷 · 旧城微光",
          range: "第 1–40 章",
          summary:
            "星核现世，旧城暗流涌动。沈砚遇见陆知微，第一次走出熟悉的废墟。",
          status: "创作中",
          beats: [
            "在废墟中发现活着的星核",
            "与陆知微相遇，签订同行约定",
            "司夜者封锁旧城，两人携星图出逃",
          ],
        },
        {
          id: "volume-2",
          title: "第二卷 · 雾海来信",
          range: "第 41–100 章",
          summary:
            "横渡无名雾海，寻找第二块星图。每一封来信，都指向一段被删除的记忆。",
          status: "规划中",
          beats: [
            "抵达雾港，追查没有寄信人的信",
            "发现点星的代价",
            "前往沉没的天文台",
          ],
        },
        {
          id: "volume-3",
          title: "第三卷 · 群星之下",
          range: "第 101–200 章",
          summary: "七城势力汇聚，观星议会的秘密浮出水面。伙伴面临各自的选择。",
          status: "规划中",
          beats: ["集齐失落星图", "与白烬第一次正面交锋", "揭开永夜契约"],
        },
        {
          id: "volume-4",
          title: "第四卷 · 黎明有名",
          range: "第 201–300 章",
          summary:
            "守住每个被遗忘的名字，让长夜第一次迎来真正属于所有人的黎明。",
          status: "规划中",
          beats: ["寻找第三条路", "众人共享记忆", "星辰归位，迎来黎明"],
        },
      ],
    },
    characters: [
      {
        id: "character-1",
        name: "沈砚",
        role: "主角",
        age: "19 岁",
        initials: "砚",
        color: "gold",
        description:
          "旧城修补匠，能听见旧物残留的记忆。在寡言的外表下，藏着不肯向长夜妥协的执拗。",
        traits: ["沉静", "执着", "重情"],
        motivation: "找回父亲留下的记忆，查明星核的来历。",
        state: "在废墟中发现星核，能力初次觉醒。",
        ...ref,
      },
      {
        id: "character-2",
        name: "陆知微",
        role: "女主角",
        age: "21 岁",
        initials: "微",
        color: "green",
        description:
          "被逐出议会的年轻观星师。她记得所有星辰的名字，却忘记了自己的过去。",
        traits: ["敏锐", "克制", "神秘"],
        motivation: "找回失去的记忆，弄清被逐出议会的原因。",
        state: "尚未在正文出场；设定中计划在旧城与沈砚相遇。",
        sourceChapterId: null,
        updatedAt,
      },
      {
        id: "character-3",
        name: "阿雀",
        role: "重要配角",
        age: "14 岁",
        initials: "雀",
        color: "blue",
        description:
          "穿梭旧城街巷的送信人，熟悉每一条暗道。总把秘密藏在漫不经心的玩笑里。",
        traits: ["机灵", "乐观", "仗义"],
        motivation: "攒够钱带妹妹离开旧城。",
        state: "尚未在正文出场；设定中负责传递旧城消息。",
        sourceChapterId: null,
        updatedAt,
      },
      {
        id: "character-4",
        name: "白烬",
        role: "主要反派",
        age: "未知",
        initials: "烬",
        color: "rose",
        description:
          "观星议会领袖，永夜秩序的守护者。他曾比任何人都渴望黎明，如今却亲手熄灭星光。",
        traits: ["冷静", "强大", "复杂"],
        motivation: "维系永夜契约，防止被封存的灾厄重临。",
        state: "尚未在正文出场；设定中掌管观星议会。",
        sourceChapterId: null,
        updatedAt,
      },
    ],
    world: [
      {
        id: "world-1",
        title: "永夜纪元",
        category: "时代背景",
        body: "七百年前，群星在一夜之间熄灭。自此太阳不再升起，人类依靠地脉微光生存。七座长夜之城是最后的聚居地。",
        updatedAt,
      },
      {
        id: "world-2",
        title: "点星与遗忘",
        category: "核心规则",
        body: "星辰承载人类共同的记忆。重新点亮一颗星，需要付出一个人被世间遗忘的代价。这一规则被观星议会严格保密。",
        updatedAt,
      },
      {
        id: "world-3",
        title: "观星议会",
        category: "组织势力",
        body: "唯一掌握古老星图的组织，统辖七城的司夜者。对外宣称守护人类，对内延续着不可告人的永夜契约。",
        updatedAt,
      },
    ],
    timeline: [
      {
        id: "event-1",
        time: "永夜元年",
        title: "群星熄灭",
        description: "永夜契约成立，太阳不再升起，旧时代的记录逐渐散佚。",
        kind: "世界历史",
        sourceChapterId: null,
        updatedAt,
      },
      {
        id: "event-2",
        time: "永夜 681 年",
        title: "沈砚出生",
        description:
          "沈砚出生于旧城修补匠家庭，父亲留给他一枚无法打开的铜制罗盘。",
        kind: "人物背景",
        sourceChapterId: null,
        updatedAt,
      },
      {
        id: "event-3",
        time: "永夜 700 年 · 第一夜",
        title: "坠落的星光",
        description:
          "沈砚在废墟发现星核，第一次听见物品中的记忆，长夜的平静开始动摇。",
        kind: "正文事件",
        ...ref,
      },
      {
        id: "event-4",
        time: "永夜 700 年 · 第二夜",
        title: "修补铺的陌生人",
        description: "陆知微循着异常星光抵达旧城，与沈砚的命运即将交汇。",
        kind: "计划事件",
        sourceChapterId: null,
        updatedAt,
      },
    ],
    chapters: [
      {
        id: "chapter-1",
        number: 1,
        volumeId: "volume-1",
        title: "坠落的星光",
        status: "草稿",
        outline:
          "沈砚进入旧城废墟寻找可修复的零件，意外发现星核。通过触碰，听见父亲的声音。以铜罗盘自行转动作为章末悬念。",
        summary:
          "沈砚在旧城废墟捡到仍在呼吸的星核，触碰后听见父亲留下的声音。多年静止的铜罗盘开始指向北方。",
        body: "长夜降临的第七百年，沈砚在旧城的废墟里，捡到了一颗还在呼吸的星星。\n\n那时他并不知道那是星星。\n\n它躺在一截锈蚀的铁轨下，只有拇指大小，被灰白的尘土遮去了大半轮廓。每隔几个呼吸，便有一道细微的光从裂隙里渗出来，像某种沉睡之物的心跳。\n\n旧城已经很久没有见过这样的光了。地脉灯的光是冷的，油脂灯的光是浑浊的，而眼前这一点微芒，干净得像老人故事里那个再也没有人见过的词——黎明。\n\n沈砚蹲下来，用袖口擦去表面的浮灰。他的手很稳。这是一个修补匠的手，修过上百只停摆的钟、无数盏熄灭的灯，还有那些主人已经不在的旧物。\n\n可当指尖碰到它时，他的手颤了一下。\n\n“别怕。”\n\n一个声音在他脑海中响起。很轻，很远，像隔着一条流淌了许多年的河。\n\n那是父亲的声音。\n\n沈砚屏住了呼吸。北面传来守夜人的铜哨声，一短两长，意味着旧城即将关闭外环闸门。他应该现在就走。所有修补匠都知道，闸门落下以后，废墟里的东西便不再属于活人。\n\n但他没有动。\n\n那一点星光在掌心缓缓收拢，露出内里一圈极细的纹路。沈砚认得那纹路。他每天早晨都会看见它，每天夜里都会试着解开它。\n\n他从衣领里拉出那枚铜罗盘。\n\n父亲离开的那天，只留下了这件东西。十九年来，无论他怎样修补，罗盘的指针始终纹丝不动。街坊说它早就坏了，说一个修补匠不该把时间花在修不好的东西上。\n\n如今，指针动了。\n\n它缓慢、坚定地越过刻度，指向北方。\n\n沈砚抬起头。废墟以北，是七百年来无人归还的长夜。",
        updatedAt,
      },
      {
        id: "chapter-2",
        number: 2,
        volumeId: "volume-1",
        title: "修补铺的陌生人",
        status: "待创作",
        outline:
          "陆知微循着星核气息来到修补铺。沈砚隐瞒发现，两人以修理罗盘为由试探彼此。章末司夜者敲门。",
        summary: "",
        body: "",
        updatedAt,
      },
      {
        id: "chapter-3",
        number: 3,
        volumeId: "volume-1",
        title: "不该存在的记忆",
        status: "待创作",
        outline:
          "司夜者搜查修补铺。沈砚从一件旧物中听见被删改的记忆，陆知微出手掩护。",
        summary: "",
        body: "",
        updatedAt,
      },
    ],
    memory: {
      locations: [
        {
          id: "location-1",
          name: "旧城废墟",
          description: "旧城外环之外，埋着旧时代铁轨与残破机械的荒地。",
          ...ref,
        },
        {
          id: "location-2",
          name: "沈记修补铺",
          description: "沈砚继承的修补铺，位于旧城南街。",
          sourceChapterId: null,
          updatedAt,
        },
      ],
      items: [
        {
          id: "item-1",
          name: "星核",
          description: "仍在呼吸的星辰碎片，能唤起物品中沉睡的记忆。",
          ...ref,
        },
        {
          id: "item-2",
          name: "铜罗盘",
          description: "父亲留下的遗物；接触星核后首次指向北方。",
          ...ref,
        },
      ],
      abilities: [
        {
          id: "ability-1",
          name: "听忆",
          description:
            "通过接触旧物听见其中残留的记忆。信息可能破碎，无法任意读取。",
          ...ref,
        },
        {
          id: "ability-2",
          name: "点星",
          description: "借助星图与星核重燃星辰。代价是一个人被世间遗忘。",
          sourceChapterId: null,
          updatedAt,
        },
      ],
      foreshadowing: [
        {
          id: "hint-1",
          name: "父亲的声音",
          description: "星核中为何存在父亲的声音？",
          status: "未回收",
          ...ref,
        },
        {
          id: "hint-2",
          name: "罗盘指向北方",
          description: "静止十九年的指针为何在此时转动？",
          status: "未回收",
          ...ref,
        },
      ],
      chapterSummaries: [
        {
          id: "summary-1",
          chapterId: "chapter-1",
          summary: "沈砚发现星核、听见父亲声音，铜罗盘开始指向北方。",
          ...ref,
        },
      ],
    },
  },
  {
    id: "zero-city",
    title: "零号城市",
    genre: "科幻",
    style: "悬念迭起",
    cover: "city",
    isDemo: true,
    status: "构思中",
    idea: "当全城人的记忆每隔七天被重置，一名修理工发现自己是唯一记得上周的人。",
    protagonist: "林序，城市底层的机械修理工，拥有不受重置影响的记忆。",
    targetWords: 500000,
    targetChapters: 200,
    wordsPerChapter: 2500,
    bible: {
      synopsis:
        "一座没有过去的城市，一名记得一切的修理工。林序在一次次重置中留下线索，试图找出是谁替全城人决定了明天。",
      conflict: "个体的真实记忆与城市的集体稳定发生冲突。",
      storyline: "从发现重置异常，到寻找同伴，最终抵达零号核心。",
      antagonist: "维护城市重置机制的秩序中枢。",
      romance: "尚未设定",
    },
    outline: {
      master:
        "林序在重置后发现昨日的修理记录仍在。他以此为线索寻找城市记忆的漏洞。",
      volumes: [],
    },
    chapters: [],
    characters: [],
    world: [],
    timeline: [],
    memory: {
      locations: [],
      items: [],
      abilities: [],
      foreshadowing: [],
      chapterSummaries: [],
    },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
  },
  {
    id: "wind-letter",
    title: "风起时有信",
    genre: "仙侠",
    style: "古典诗意",
    cover: "wind",
    isDemo: true,
    status: "构思中",
    idea: "一个替亡者送信的少女，在最后一封信里读到了自己的名字。",
    protagonist: "温杳，山间驿站的送信人，不修长生，只愿每封信都有归处。",
    targetWords: 600000,
    targetChapters: 240,
    wordsPerChapter: 2500,
    bible: {
      synopsis:
        "青山万里，故人无期。温杳替亡者走过千山万水，却在最后一封信里，看见了还未发生的自己的人生。",
      conflict: "明知结局的命运，与仍愿选择的自由。",
      storyline: "送信途中发现自己的身世，逐步揭开山河之间的旧约。",
      antagonist: "尚未设定",
      romance: "少女与守山人于一封封旧信中相识。",
    },
    outline: {
      master:
        "以七封旧信串联江湖与仙门，温杳最终选择亲手写下不在预言中的结局。",
      volumes: [],
    },
    chapters: [],
    characters: [],
    world: [],
    timeline: [],
    memory: {
      locations: [],
      items: [],
      abilities: [],
      foreshadowing: [],
      chapterSummaries: [],
    },
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  },
];
