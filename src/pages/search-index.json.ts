import type { APIRoute } from 'astro';
import { authors, getDynasty, getEra, poemPath, authorPath, poems } from '../lib/content';
import { normalizeText } from '../lib/hanzi-search';
import type { AuthorDoc, PoemDoc, SearchIndex } from '../lib/hanzi-search';

/**
 * 构建期生成汉字搜索索引：/search-index.json
 * 只输出标题、作者、时期、体裁、学段、教材、名句与编号，不包含正文。
 */

function eraLabel(dynastyId: string, eraId: string): string {
  const dynasty = getDynasty(dynastyId);
  const era = getEra(dynastyId, eraId);
  return `${dynasty?.label ?? dynastyId}·${era?.label ?? eraId}`;
}

export const GET: APIRoute = () => {
  // 作者索引与作品数：一次遍历建表，避免 O(n²) 查找
  const authorById = new Map(authors.map((author) => [author.id, author]));
  const poemCount = new Map<string, number>();
  for (const poem of poems) {
    poemCount.set(poem.authorId, (poemCount.get(poem.authorId) ?? 0) + 1);
  }

  const poemDocs: PoemDoc[] = poems
    .slice()
    .sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
    .map((poem) => {
      const author = authorById.get(poem.authorId);
      return {
        u: poemPath(poem),
        t: poem.title,
        n: normalizeText(poem.title),
        a: author?.name ?? poem.authorId,
        au: author ? authorPath(author) : '',
        e: eraLabel(poem.dynasty, poem.era),
        f: poem.form ?? '',
        g: poem.gradeBand ?? '',
        tb: poem.textbook ?? '',
        q: poem.famousLines?.[0] ?? '',
        no: poem.no ?? 0
      };
    });

  const authorDocs: AuthorDoc[] = authors.map((author) => ({
    a: author.name,
    an: normalizeText(author.name),
    au: authorPath(author),
    e: eraLabel(author.dynasty, author.era),
    y: author.yearsLabel ?? '',
    c: poemCount.get(author.id) ?? 0
  }));

  const index: SearchIndex = { poems: poemDocs, authors: authorDocs };

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
};
