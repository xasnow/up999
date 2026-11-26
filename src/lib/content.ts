import dynastiesData from '../data/dynasties.json';
import topicsData from '../data/topics.json';
import siteConfig from '../data/site-config.json';

/** 全站配图开关（src/data/site-config.json）：false 隐藏封面/分镜，代码与数据保留 */
export const IMAGES_ENABLED = siteConfig.imagesEnabled !== false;

/** 取作品封面；配图关闭时返回 null，页面自动退回文字占位 */
export function getCover(poem: any): any {
  return IMAGES_ENABLED ? (poem.images?.cover ?? null) : null;
}

// 构建期一次性读取全部数据，生成索引（作者→作品、时期→作者、上一首/下一首）
const authorModules = import.meta.glob('../data/authors/*.json', {
  eager: true,
  import: 'default'
});
const poemModules = import.meta.glob('../data/poems/*.json', {
  eager: true,
  import: 'default'
});

export const dynasties: any[] = dynastiesData as any[];
export const topics: any[] = topicsData as any[];
export const authors: any[] = Object.values(authorModules) as any[];
export const poems: any[] = Object.values(poemModules) as any[];

export function getDynasty(id: string): any {
  return dynasties.find((d) => d.id === id);
}

export function getEra(dynastyId: string, eraId: string): any {
  const d = getDynasty(dynastyId);
  return d ? d.eras.find((e: any) => e.id === eraId) : undefined;
}

export function getAuthor(id: string): any {
  return authors.find((a) => a.id === id);
}

export function authorsOfDynasty(dynastyId: string): any[] {
  return authors.filter((a) => a.dynasty === dynastyId);
}

export function authorsOfEra(dynastyId: string, eraId: string): any[] {
  return authors
    .filter((a) => a.dynasty === dynastyId && a.era === eraId)
    .sort((x, y) => (x.birthYear ?? 9999) - (y.birthYear ?? 9999));
}

export function poemsOfDynasty(dynastyId: string): any[] {
  return poems.filter((p) => p.dynasty === dynastyId);
}

export function poemsOfEra(dynastyId: string, eraId: string): any[] {
  return poems.filter((p) => p.dynasty === dynastyId && p.era === eraId);
}

/** 同一作者的作品按写作时间排序（writtenYear + orderInAuthor） */
export function poemsOfAuthor(authorId: string): any[] {
  return poems
    .filter((p) => p.authorId === authorId)
    .sort(
      (a, b) => a.writtenYear - b.writtenYear || a.orderInAuthor - b.orderInAuthor
    );
}

/** 同一作者内的上一首/下一首（不跨作者，与方案 3.3 结论一致） */
export function poemNeighbors(poem: any): { prev: any; next: any } {
  const list = poemsOfAuthor(poem.authorId);
  const idx = list.findIndex((p) => p.id === poem.id);
  return {
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  };
}

export function authorPath(author: any): string {
  return `/${author.dynasty}/${author.era}/${author.slug}/`;
}

export function poemPath(poem: any): string {
  return `/${poem.dynasty}/${poem.era}/${poem.authorId}/${poem.slug}/`;
}

export function eraPath(dynastyId: string, eraId: string): string {
  return `/${dynastyId}/${eraId}/`;
}

export function countsOfEra(dynastyId: string, eraId: string): { authors: number; poems: number } {
  return {
    authors: authorsOfEra(dynastyId, eraId).length,
    poems: poemsOfEra(dynastyId, eraId).length
  };
}

export function gradeLabel(band: string): string {
  const map: Record<string, string> = {
    'g1-2': '一~二年级',
    'g3-4': '三~四年级',
    'g5-6': '五~六年级',
    ext: '拓展'
  };
  return map[band] ?? band;
}

/** 今日一诗：构建期按日期轮换，无需接口 */
export function todayPoem(): any {
  const day = Math.floor(Date.now() / 86400000);
  return poems[day % poems.length];
}

// ---------- 专题（按 tags 聚合，数据见 src/data/topics.json） ----------

export function topicPath(topic: any): string {
  return `/topics/${topic.slug}/`;
}

/** 主题的标签池：有 sections 用全部小节的并集，否则用 tags */
export function topicTagPool(topic: any): string[] {
  if (topic.sections?.length) return topic.sections.flatMap((s: any) => s.tags);
  return topic.tags ?? [];
}

const GRADE_ORDER: Record<string, number> = { 'g1-2': 0, 'g3-4': 1, 'g5-6': 2, ext: 3 };

/** 匹配某主题的作品：按学段由低到高、再按拼音排序，方便按难度阅读 */
export function poemsOfTopic(topic: any): any[] {
  const pool = new Set(topicTagPool(topic));
  return poems
    .filter((p) => (p.tags ?? []).some((t: string) => pool.has(t)))
    .sort(
      (a, b) =>
        (GRADE_ORDER[a.gradeBand] ?? 9) - (GRADE_ORDER[b.gradeBand] ?? 9) ||
        String(a.titlePinyin ?? a.title).localeCompare(String(b.titlePinyin ?? b.title), 'zh')
    );
}

/** 一首诗属于哪些主题（详情页底部互链用） */
export function topicsOfPoem(poem: any): any[] {
  return topics.filter((t) => {
    const pool = new Set(topicTagPool(t));
    return (poem.tags ?? []).some((x: string) => pool.has(x));
  });
}

/** 与某首诗共享标签最多的作品（详情页底部推荐，不含自身） */
export function relatedPoems(poem: any, n = 6): any[] {
  const mine = new Set(poem.tags ?? []);
  return poems
    .filter((p) => p.id !== poem.id)
    .map((p) => ({ p, shared: (p.tags ?? []).filter((t: string) => mine.has(t)).length }))
    .filter((x) => x.shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        (GRADE_ORDER[a.p.gradeBand] ?? 9) - (GRADE_ORDER[b.p.gradeBand] ?? 9)
    )
    .slice(0, n)
    .map((x) => x.p);
}

/** 大类内代表诗人：按作品数取前 N 位 */
export function featuredAuthors(dynastyId: string, n = 6): any[] {
  return authorsOfDynasty(dynastyId)
    .map((a) => ({ author: a, count: poemsOfAuthor(a.id).length }))
    .sort((x, y) => y.count - x.count)
    .slice(0, n)
    .map((x) => x.author);
}
