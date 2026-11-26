#!/usr/bin/env node
/**
 * 内容清单台账：扫描 src/data/poems + 音频 + 配图，与 data/plan.csv 对账
 * - 把 plan.csv 的全局编号（no）写回作品 JSON（缺失时）
 * - 生成 scripts/content-manifest.csv（实际状态台账，入库 git）
 * - 输出批次进度与音频额度统计
 * 用法：npm run manifest
 *
 * 编号段规划：存量+批次A 0001+；批次B(唐诗三百首) 1001–1999；批次C(宋词) 2001+；批次D(其他经典) 3001+
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const POEM_DIR = path.join(ROOT, 'src', 'data', 'poems');
const AUTHOR_DIR = path.join(ROOT, 'src', 'data', 'authors');
const AUDIO_DIR = path.join(ROOT, 'public', 'assets', 'audio', 'poems');
const IMG_DIR = path.join(ROOT, 'public', 'assets', 'img', 'poems');
const PLAN = path.join(ROOT, 'data', 'plan.csv');
const OUT = path.join(ROOT, 'scripts', 'content-manifest.csv');

const PUNCT_RE = /[\s，。？！、；：""''《》（）·—…,.?!;:'"()\-]/g;

// ---------- 读取 ----------
const authors = fs.readdirSync(AUTHOR_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(AUTHOR_DIR, f), 'utf8')));
const idToAuthor = new Map(authors.map((a) => [a.id, a]));
const poemFiles = fs.readdirSync(POEM_DIR).filter((f) => f.endsWith('.json'));
const poems = poemFiles.map((f) => ({ file: f, p: JSON.parse(fs.readFileSync(path.join(POEM_DIR, f), 'utf8')) }));

// ---------- plan.csv ----------
const csv = fs.readFileSync(PLAN, 'utf8');
const planLines = csv.split(/\r?\n/).slice(1).filter(Boolean);
const planRows = planLines.map((line) => {
  const cols = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(line))) cols.push(m[1]);
  return {
    no: Number(cols[0]), batch: cols[1], tier: cols[2], slug: cols[3], title: cols[4],
    author: cols[5], authorId: cols[6], era: cols[7], form: cols[8],
    needAudio: cols[9], needImage: cols[10], status: cols[11], note: cols[12]
  };
});

// ---------- 把 no 写回 JSON（匹配：slug 优先，其次 归一题名+作者） ----------
const normTitle = (t) => t.replace(/·.*$/, '').replace(/（.+?）$/, '').trim();
let written = 0;
const usedNo = new Set();
for (const { file, p } of poems) {
  if (p.no != null) { usedNo.add(p.no); continue; }
  const row =
    planRows.find((r) => r.slug && r.slug === p.slug) ??
    planRows.find((r) => normTitle(r.title) === normTitle(p.title) && r.authorId === p.authorId);
  if (row && !usedNo.has(row.no)) {
    p.no = row.no;
    usedNo.add(row.no);
    fs.writeFileSync(path.join(POEM_DIR, file), JSON.stringify(p, null, 2) + '\n', 'utf8');
    written++;
  }
}

// ---------- 台账 ----------
const audioFiles = new Set(fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3')) : []);
const imgFiles = new Set(fs.existsSync(IMG_DIR) ? fs.readdirSync(IMG_DIR).filter((f) => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.webp')) : []);

const rows = [];
for (const { file, p } of poems) {
  const a = idToAuthor.get(p.authorId);
  const row = planRows.find((r) => r.slug === p.slug) ?? planRows.find((r) => normTitle(r.title) === normTitle(p.title) && r.authorId === p.authorId) ?? planRows.find((r) => r.slug === p.slug);
  const text = `${p.title}${a?.name ?? ''}${p.lines.map((l) => l.text).join('')}`.replace(PUNCT_RE, '');
  const chars = [...text].length;
  const stat = fs.statSync(path.join(POEM_DIR, file));
  const audio = audioFiles.has(`${p.slug}.mp3`);
  const cover = p.images?.cover ? imgFiles.has(path.basename(p.images.cover.src)) : false;
  const panels = (p.images?.panels ?? []).length;
  const no = p.no ?? row?.no ?? '';
  rows.push({
    no, batch: row?.batch ?? '', tier: row?.tier ?? '', slug: p.slug, title: p.title,
    author: a?.name ?? p.authorId, authorId: p.authorId, era: `${p.dynasty}/${p.era}`,
    form: p.form, gradeBand: p.gradeBand, chars,
    audio: audio ? 'yes' : 'no', audioKB: audio ? Math.round(fs.statSync(path.join(AUDIO_DIR, `${p.slug}.mp3`)).size / 1024) : 0,
    cover: cover ? 'yes' : 'no', panels,
    createdAt: stat.birthtime.toISOString().slice(0, 10), updatedAt: p.updatedAt ?? '',
    status: p.status ?? ''
  });
}
// plan 中 todo 但无 JSON 的行也列出（缺口）
const doneSlugs = new Set(rows.map((r) => r.slug));
for (const r of planRows) {
  if (r.status === 'done' && r.slug && !doneSlugs.has(r.slug)) {
    rows.push({ no: r.no, batch: r.batch, tier: r.tier, slug: r.slug, title: r.title, author: r.author, authorId: r.authorId, era: r.era, form: r.form, gradeBand: '', chars: '', audio: '-', audioKB: 0, cover: '-', panels: 0, createdAt: '', updatedAt: '', status: 'MISSING(计划done但无文件)' });
  }
}

rows.sort((x, y) => (Number(x.no) || 9999) - (Number(y.no) || 9999));
const outCsv = ['no,batch,tier,slug,title,author,authorId,era,form,gradeBand,chars,audio,audioKB,cover,panels,createdAt,updatedAt,status',
  ...rows.map((r) => [r.no, r.batch, r.tier, r.slug, r.title, r.author, r.authorId, r.era, r.form, r.gradeBand, r.chars, r.audio, r.audioKB, r.cover, r.panels, r.createdAt, r.updatedAt, r.status].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
].join('\r\n');
fs.writeFileSync(OUT, outCsv, 'utf8');

// ---------- 统计 ----------
const byBatch = {};
for (const r of rows) {
  const b = r.batch || '未编入plan';
  byBatch[b] ??= { done: 0, todo: 0 };
  const st = r.status === 'MISSING(计划done但无文件)' ? 'todo' : 'done';
  byBatch[b][st]++;
}
console.log('== 批次进度 ==');
for (const [b, v] of Object.entries(byBatch)) console.log(`  ${b}: 完成 ${v.done}${v.todo ? `，待做 ${v.todo}` : ''}`);

// 音频额度（新批次：chars<=100 才生成）
const pendingAudio = rows.filter((r) => r.batch && r.batch !== 'base' && r.audio === 'no' && typeof r.chars === 'number');
const shortPending = pendingAudio.filter((r) => r.chars <= 100);
const longPending = pendingAudio.filter((r) => r.chars > 100);
const shortChars = shortPending.reduce((s, r) => s + r.chars, 0);
console.log('== 音频额度（新增批次，单首 >100 字暂缓） ==');
console.log(`  可立即生成：${shortPending.length} 首，约 ${shortChars} 字`);
console.log(`  暂缓（>100字）：${longPending.length} 首，约 ${longPending.reduce((s, r) => s + r.chars, 0)} 字（长恨歌/琵琶行等）`);
console.log(`✓ 台账已生成：${path.relative(ROOT, OUT)}（${rows.length} 行）；回写编号 ${written} 首`);
