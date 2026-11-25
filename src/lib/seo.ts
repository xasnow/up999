import seoData from '../data/seo.json';
import { getDynasty, gradeLabel } from './content';

export const SITE_KEYWORDS = seoData as {
  site: string;
  pages: Record<string, string>;
  _comment?: string;
};

/** 按大类取 seo.json 配置的关键词 */
export function pageKeywords(key: string): string {
  return SITE_KEYWORDS.pages[key] ?? SITE_KEYWORDS.site;
}

/** 作品页关键词：大类关键词 + 标题/作者/学段/名句 */
export function poemKeywords(poem: any, author: any): string {
  const base = pageKeywords(poem.dynasty);
  const parts = [
    `${poem.title}`,
    `${poem.title}拼音`,
    `${poem.title}${poem.dynasty === 'songci' ? '词意' : '诗意'}`,
    poem.title,
    `${author.name}的诗`,
    `${author.name}`,
    `${gradeLabel(poem.gradeBand)}必背`,
    '小学生古诗词',
    '古诗拼音版',
    '古诗译文注释'
  ];
  if (poem.famousLines?.[0]) parts.push(poem.famousLines[0]);
  return `${base}, ${parts.join(', ')}`;
}

/** 作者页关键词：大类关键词 + 作者/朝代相关词 */
export function authorKeywords(author: any, dynastyLabel: string): string {
  const base = pageKeywords(author.dynasty);
  const parts = [
    `${author.name}`,
    `${author.name}简介`,
    `${author.name}生平`,
    `${author.name}的诗`,
    `${dynastyLabel}${poemNoun(author.dynasty)}`,
    '小学生古诗词',
    '古诗拼音版'
  ];
  return `${base}, ${parts.join(', ')}`;
}

function poemNoun(dynastyId: string): string {
  return dynastyId === 'songci' ? '词人' : '诗人';
}

/** 作品页 JSON-LD：面包屑 + 文章 */
export function poemJsonLd(poem: any, author: any, dynastyLabel: string, eraLabel: string, coverUrl?: string) {
  const base = 'https://up999.cn';
  const url = `${base}/${poem.dynasty}/${poem.era}/${poem.authorId}/${poem.slug}/`;
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: dynastyLabel, item: `${base}/${poem.dynasty}/` },
      { '@type': 'ListItem', position: 3, name: eraLabel, item: `${base}/${poem.dynasty}/${poem.era}/` },
      { '@type': 'ListItem', position: 4, name: author.name, item: `${base}/${poem.dynasty}/${poem.era}/${poem.authorId}/` },
      { '@type': 'ListItem', position: 5, name: poem.title, item: url }
    ]
  };
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${poem.title} · ${author.name}`,
    description: `${poem.title}（${author.name}）：带拼音、注释、译文和时间线讲解，适合小学生学习。`,
    inLanguage: 'zh-CN',
    url,
    mainEntityOfPage: url,
    ...(coverUrl ? { image: `${base}${coverUrl}` } : {}),
    author: { '@type': 'Person', name: author.name },
    publisher: { '@type': 'Organization', name: '每天一首小古诗 · up999.cn' }
  };
  return [breadcrumb, article];
}
