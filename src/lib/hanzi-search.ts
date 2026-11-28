/**
 * 汉字搜索核心逻辑（纯函数，无数据依赖）
 *
 * 构建期由 /search-index.json 端点生成索引，浏览器端由 /search/ 页面执行查询，
 * 两侧共用本文件的归一化函数，保证「索引口径 = 查询口径」。
 *
 * 方案文档：docs/hanzi-search-plan.md
 */

/** 索引中的作品条目（字段名刻意缩短，控制索引体积） */
export interface PoemDoc {
  /** 作品 URL */
  u: string;
  /** 标题原文（展示用） */
  t: string;
  /** 归一化标题（匹配用） */
  n: string;
  /** 作者名 */
  a: string;
  /** 作者 URL */
  au: string;
  /** 朝代·时期，如「唐诗·盛唐」 */
  e: string;
  /** 体裁，如「七言绝句」 */
  f: string;
  /** 学段代码：g1-2 / g3-4 / g5-6 / ext */
  g: string;
  /** 教材篇目，非教材为空串 */
  tb: string;
  /** 名句（famousLines[0]），无则为空串 */
  q: string;
  /** 全局编号，仅用于稳定排序 */
  no: number;
}

/** 索引中的作者条目 */
export interface AuthorDoc {
  /** 姓名 */
  a: string;
  /** 归一化姓名（匹配用） */
  an: string;
  /** 作者页 URL */
  au: string;
  /** 朝代·时期 */
  e: string;
  /** 生卒/年份标签 */
  y: string;
  /** 名下作品数 */
  c: number;
}

export interface SearchIndex {
  poems: PoemDoc[];
  authors: AuthorDoc[];
}

export interface PoemHit {
  doc: PoemDoc;
  /** 匹配层级：0 完全相等 / 1 前缀 / 2 中间 */
  layer: number;
  /** 命中位置，用于同层排序 */
  idx: number;
}

export interface AuthorHit {
  doc: AuthorDoc;
  layer: number;
}

export type SearchMode = 'empty' | 'latin' | 'ok';

export interface SearchOutcome {
  mode: SearchMode;
  /** 归一化后的完整查询 */
  q: string;
  /** 实际用于标题匹配的片段（组合输入时已去掉作者名） */
  titleQ: string;
  /** 组合输入命中的作者名，空串表示未走组合解析 */
  authorFilter: string;
  authors: AuthorHit[];
  poems: PoemHit[];
}

/**
 * 归一化：删除中英文标点、词牌分隔符与所有空白，只保留汉字/数字/字母。
 * 目的：让「悯农（其二）」与用户输入的「悯农其二」能互相匹配。
 */
const STRIP_RE = /[\s\u3000（）()\[\]【】「」『』《》〈〉〔〕｛｝{}·・、，。！？；：,.!?;:""''“”‘’—–\-…~～`@#$%^&*+=|\\/<>＜＞]/g;

export function normalizeText(input: string): string {
  return (input || '').replace(STRIP_RE, '');
}

/** 是否含汉字（用于识别拼音组合中的拉丁串） */
export function hasHanzi(input: string): boolean {
  return /[\u4e00-\u9fff]/.test(input);
}

/** 学段代码转展示文案 */
export function gradeLabel(band: string): string {
  const map: Record<string, string> = {
    'g1-2': '一~二年级',
    'g3-4': '三~四年级',
    'g5-6': '五~六年级',
    ext: '拓展'
  };
  return map[band] ?? band;
}

/** 学段排序权重：低年级优先 */
const GRADE_RANK: Record<string, number> = {
  'g1-2': 0,
  'g3-4': 1,
  'g5-6': 2,
  ext: 3
};

function layerOf(text: string, query: string): number {
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  return 2;
}

/**
 * 执行一次查询。
 * 空查询 / 纯标点 → mode='empty'（调用方必须回到默认状态，不渲染列表）
 * 不含汉字（拼音组合中）→ mode='latin'（调用方只提示，不渲染结果）
 */
export function search(index: SearchIndex, raw: string): SearchOutcome {
  const q = normalizeText(raw);
  const base: SearchOutcome = {
    mode: 'ok',
    q,
    titleQ: q,
    authorFilter: '',
    authors: [],
    poems: []
  };

  if (!q) return { ...base, mode: 'empty' };
  if (!hasHanzi(q)) return { ...base, mode: 'latin' };

  // 1) 组合输入解析：作者全名开头 + 剩余部分能匹配到该作者的作品
  let comboAuthor: AuthorDoc | null = null;
  let titleQ = q;
  const byLength = index.authors.slice().sort((a, b) => b.an.length - a.an.length);
  for (const author of byLength) {
    if (!author.an || q.length <= author.an.length || !q.startsWith(author.an)) continue;
    const rest = q.slice(author.an.length);
    if (!rest) continue;
    const matched = index.poems.some((p) => p.au === author.au && p.n.includes(rest));
    if (matched) {
      comboAuthor = author;
      titleQ = rest;
      break;
    }
  }

  // 2) 作者命中：始终折叠为一张卡，不展开作品
  const authors: AuthorHit[] = index.authors
    .filter((a) => a.an.includes(q))
    .map((doc) => ({ doc, layer: layerOf(doc.an, q) }))
    .sort((x, y) => x.layer - y.layer || y.doc.c - x.doc.c || x.doc.a.localeCompare(y.doc.a, 'zh'));

  // 3) 作品命中：组合输入时限定该作者，否则全站标题匹配
  const poems: PoemHit[] = [];
  for (const doc of index.poems) {
    if (comboAuthor && doc.au !== comboAuthor.au) continue;
    const idx = doc.n.indexOf(titleQ);
    if (idx < 0) continue;
    poems.push({ doc, layer: layerOf(doc.n, titleQ), idx });
  }
  poems.sort(comparePoem);

  return {
    mode: 'ok',
    q,
    titleQ,
    authorFilter: comboAuthor ? comboAuthor.a : '',
    authors,
    poems
  };
}

/**
 * 作品排序：匹配层级 → 教材篇目 → 学段 → 有名句 → 全局编号（稳定）
 * 注意：no 只是稳定排序键，不代表热度。
 */
function comparePoem(x: PoemHit, y: PoemHit): number {
  if (x.layer !== y.layer) return x.layer - y.layer;

  const xt = x.doc.tb ? 0 : 1;
  const yt = y.doc.tb ? 0 : 1;
  if (xt !== yt) return xt - yt;

  const xg = GRADE_RANK[x.doc.g] ?? 9;
  const yg = GRADE_RANK[y.doc.g] ?? 9;
  if (xg !== yg) return xg - yg;

  const xq = x.doc.q ? 0 : 1;
  const yq = y.doc.q ? 0 : 1;
  if (xq !== yq) return xq - yq;

  if (x.doc.no !== y.doc.no) return x.doc.no - y.doc.no;
  return x.idx - y.idx;
}

export function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 把命中的片段包成 <mark>，其余内容做 HTML 转义。
 * 原文里找不到查询串时（例如归一化删掉了括号）只转义不标红。
 */
export function highlightHtml(text: string, query: string): string {
  const src = text || '';
  const q = query || '';
  if (!q) return escapeHtml(src);
  const at = src.indexOf(q);
  if (at < 0) return escapeHtml(src);
  return (
    escapeHtml(src.slice(0, at)) +
    '<mark>' +
    escapeHtml(src.slice(at, at + q.length)) +
    '</mark>' +
    escapeHtml(src.slice(at + q.length))
  );
}
