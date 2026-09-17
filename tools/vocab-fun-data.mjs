/**
 * 趣味记忆库（人工维护）
 * ============================================================================
 * 用途：词卡背面显示一句「记忆钩子」。
 *
 * 三条自我约束 —— 编得牵强不如不编，错误的联想比没有联想更伤记忆：
 *   1. translit（音译）**必须是中文里真在用的音译词**，如 chocolate→巧克力。
 *      这类最可靠：读音和意思都是现成的，不需要「编」。
 *   2. homophone（谐音）只收流传广、且**能在课堂上念出来**的。低俗的、地域梗的、
 *      拿人体开玩笑的一律不收。
 *   3. split（拆词）必须是**真实构词**（breakfast = break + fast），
 *      拿不准词源的就不写 —— 词根词缀那部分由 tools/vocab-enrich.mjs 按词表严格校验。
 *
 * 字段：w 单词（小写单词，不要词组/变形）｜kind 类型｜text 提示（≤ 40 汉字）
 */

/** 音译词：中文里已经在用，读音直接对上，最好记 */
const TRANSLIT = {
  coffee: '咖啡',
  chocolate: '巧克力',
  sofa: '沙发',
  tank: '坦克',
  logic: '逻辑',
  humor: '幽默',
  typhoon: '台风',
  tofu: '豆腐',
  mahjong: '麻将',
  litchi: '荔枝',
  sampan: '舢板',
  kungfu: '功夫',
  dimsum: '点心',
  golf: '高尔夫',
  bowling: '保龄球',
  marathon: '马拉松',
  olympic: '奥林匹克',
  radar: '雷达',
  laser: '激光',
  sonar: '声纳',
  motor: '马达',
  engine: '引擎',
  jeep: '吉普',
  taxi: '的士',
  bus: '巴士',
  card: '卡片',
  fee: '费',
  jacket: '夹克',
  salad: '沙拉',
  pizza: '比萨',
  sandwich: '三明治',
  hamburger: '汉堡',
  toast: '吐司',
  pudding: '布丁',
  cookie: '曲奇',
  lemon: '柠檬',
  mango: '芒果',
  jazz: '爵士',
  guitar: '吉他',
  piano: '钢琴（音译自 pianoforte）',
  saxophone: '萨克斯',
  ballet: '芭蕾',
  cigar: '雪茄',
  whisky: '威士忌',
  vodka: '伏特加',
  champagne: '香槟',
  brandy: '白兰地',
  nylon: '尼龙',
  model: '模特',
  cartoon: '卡通',
  disco: '迪斯科',
  mosaic: '马赛克',
  shampoo: '香波',
  sauna: '桑拿',
  yoga: '瑜伽',
  bikini: '比基尼',
  vitamin: '维他命',
  gene: '基因',
  clone: '克隆',
  hacker: '黑客',
  microphone: '麦克风',
  aspirin: '阿司匹林',
  morphine: '吗啡',
  nicotine: '尼古丁',
  penicillin: '盘尼西林（青霉素的旧译名）',
  internet: '因特网',
  cool: '酷',
  fans: '粉丝',
};

/** 谐音：流传广、能当众念出来的经典条目 */
const HOMOPHONE = {
  ambulance: '谐音「俺不能死」—— 救护车来了，就是有人等着救命',
  pest: '谐音「拍死它」—— 害虫的下场就写在读音里',
  ambition: '谐音「俺必胜」—— 雄心就是这股劲',
  university: '谐音「由你玩四年」—— 大学怎么过，全看自己',
  admire: '谐音「额的妈呀」—— 佩服到脱口而出',
  umbrella: '谐音「俺不来了」—— 下雨没伞，就不来了',
  economy: '谐音「依靠农民」—— 农业是经济的地基',
  bachelor: '谐音「白吃了」—— 单身汉一人吃饱全家不饿',
  salary: '谐音「杀了我」—— 为这点薪水拼到怀疑人生',
  furniture: '谐音「房里缺」—— 家具就是房里缺的东西',
  strong: '谐音「死壮」—— 又死又壮，就是强壮',
  banana: '谐音「不拿了」—— 香蕉便宜到懒得拿',
  temper: '谐音「太泼」—— 脾气太泼就是暴脾气',
  lawyer: '谐音「老爷」—— 旧时打官司得请「老爷」',
  pregnant: '谐音「扑来个男的」—— 怀孕这事总得有人负责',
  colleague: '谐音「靠你哥」—— 同事之间互相靠一靠',
  catalogue: '谐音「看它log」—— 目录就是把条目一条条记下来',
};

/** 拆词：真实构词，不是硬编的联想 */
const SPLIT = {
  breakfast: 'break（打破）+ fast（禁食）—— 早餐就是「打破一夜的禁食」',
  helicopter: 'helico（螺旋）+ pter（翼）—— 螺旋翼的飞行器',
  telephone: 'tele（远）+ phone（声音）—— 把声音传到远处',
  television: 'tele（远）+ vision（影像）—— 远处传来的影像',
  telescope: 'tele（远）+ scope（看）—— 用来看远处的东西',
  bicycle: 'bi（两）+ cycle（轮）—— 两个轮子',
  biology: 'bio（生命）+ -logy（学科）—— 研究生命的学科',
  photograph: 'photo（光）+ graph（写）—— 用光写下来的图像',
  transaction: 'trans（跨越）+ act（做）+ -ion —— 双方之间的交换动作',
  subscription: 'sub（在下）+ script（写）+ -ion —— 在文件下方签字订购',
  supermarket: 'super（超）+ market（市场）—— 超大的市场',
  earthquake: 'earth（地）+ quake（震动）—— 大地在震',
  greenhouse: 'green（绿）+ house（房）—— 让植物保持常绿的房子',
  waterfall: 'water（水）+ fall（落）—— 水落下来',
  sunflower: 'sun（太阳）+ flower（花）—— 追着太阳开的花',
  rainbow: 'rain（雨）+ bow（弓）—— 雨后天空的弓',
  deadline: 'dead（死）+ line（线）—— 越过去就「死」的线',
  homework: 'home（家）+ work（工作）—— 带回家做的工作',
  newspaper: 'news（新闻）+ paper（纸）—— 印新闻的纸',
  weekend: 'week（周）+ end（末）—— 一周的末尾',
  bookcase: 'book（书）+ case（箱柜）—— 装书的柜子',
  background: 'back（后）+ ground（地面）—— 背后的那片底',
  moonlight: 'moon（月）+ light（光）—— 月光',
  notebook: 'note（笔记）+ book（本）—— 记笔记的本子',
  workshop: 'work（工作）+ shop（铺子）—— 干活的铺子，引申为工作坊',
  framework: 'frame（框架）+ work（结构）—— 搭好的骨架',
  broadcast: 'broad（广）+ cast（撒）—— 广泛地撒出去，就是广播',
  outstanding: 'out（出）+ standing（站立）—— 站出来、显眼，所以是「杰出的」',
  underestimate: 'under（在下）+ estimate（估计）—— 估到下面去了，低估',
  misunderstand: 'mis（错）+ understand（理解）—— 理解错了',
  overcome: 'over（越过）+ come（来）—— 越过去，就是克服',
  foresee: 'fore（前）+ see（看）—— 提前看到，预见',
  evidence: 'e（向外）+ vid（看）+ -ence —— 能拿出来给人看的东西，就是证据',
};

import { SPLIT_ROOT } from './vocab-fun-roots.mjs';

export const FUN = [
  ...Object.entries(TRANSLIT).map(([w, text]) => ({
    w,
    kind: 'translit',
    text: `中文里的「${text}」就是这个词的音译 —— 读音和意思都是现成的`,
  })),
  ...Object.entries(HOMOPHONE).map(([w, text]) => ({ w, kind: 'homophone', text })),
  ...Object.entries(SPLIT).map(([w, text]) => ({ w, kind: 'split', text })),
  // 第二批：词根词源拆解（六级/考研高频词，见 vocab-fun-roots.mjs）
  ...Object.entries(SPLIT_ROOT).map(([w, text]) => ({ w, kind: 'split', text })),
];
