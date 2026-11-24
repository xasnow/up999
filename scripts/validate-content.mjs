#!/usr/bin/env node
/**
 * 内容校验（对应方案附录 A 的 10 条规则）
 * 作为 prebuild 钩子运行，任一条不通过则构建失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'src', 'data');
const PUBLIC = path.join(ROOT, 'public');

const errors = [];
const err = (file, msg) => errors.push(`[${file}] ${msg}`);

// 深度遍历字符串字段
const scanStrings = (obj, fn) => {
  const walk = (v) => {
    if (typeof v === 'string') fn(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
};

// ---------- 读取数据 ----------
const dynasties = JSON.parse(fs.readFileSync(path.join(DATA, 'dynasties.json'), 'utf8'));
const readDirJson = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      file: path.relative(ROOT, path.join(dir, f)),
      data: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    }));

const authorFiles = readDirJson(path.join(DATA, 'authors'));
const poemFiles = readDirJson(path.join(DATA, 'poems'));

const eraIndex = new Map(); // "tangshi/shengtang"
for (const d of dynasties) {
  for (const e of d.eras) eraIndex.set(`${d.id}/${e.id}`);
}
const dynastyIds = new Set(dynasties.map((d) => d.id));

// ---------- 规则 1：slug 全站唯一、格式合法 ----------
const SLUG_RE = /^[a-z0-9-]+$/;
const slugSeen = new Map();
for (const { file, data: a } of authorFiles) {
  if (!SLUG_RE.test(a.slug ?? '')) err(file, `slug 非法：${a.slug}（仅允许 a-z 0-9 -）`);
  if (slugSeen.has(a.slug)) err(file, `slug 重复：${a.slug}（已在 ${slugSeen.get(a.slug)} 使用）`);
  slugSeen.set(a.slug, file);
}
for (const { file, data: p } of poemFiles) {
  if (!SLUG_RE.test(p.slug ?? '')) err(file, `slug 非法：${p.slug}`);
  if (slugSeen.has(p.slug)) err(file, `slug 重复：${p.slug}（已在 ${slugSeen.get(p.slug)} 使用）`);
  slugSeen.set(p.slug, file);
}

// ---------- 规则 2：引用完整性 ----------
const authorIds = new Set(authorFiles.map((a) => a.data.id));
for (const { file, data: a } of authorFiles) {
  if (!a.id) err(file, '缺少 id 字段');
  if (!dynastyIds.has(a.dynasty)) err(file, `dynasty 不存在：${a.dynasty}`);
  if (!eraIndex.has(`${a.dynasty}/${a.era}`)) err(file, `era 不存在：${a.dynasty}/${a.era}`);
  if (a.slug !== a.id) err(file, `slug 与 id 不一致：${a.slug} / ${a.id}`);
  if (typeof a.birthYear !== 'number' || typeof a.deathYear !== 'number') {
    err(file, 'birthYear / deathYear 必须为数字（未知用 null 需同时改 yearsLabel）');
  }
}
for (const { file, data: p } of poemFiles) {
  if (!p.id) err(file, '缺少 id 字段');
  if (!dynastyIds.has(p.dynasty)) err(file, `dynasty 不存在：${p.dynasty}`);
  if (!eraIndex.has(`${p.dynasty}/${p.era}`)) err(file, `era 不存在：${p.dynasty}/${p.era}`);
  if (!authorIds.has(p.authorId)) err(file, `authorId 不存在：${p.authorId}`);
}

// ---------- 拼音与结构校验（规则 3/4/5/6/7/8） ----------
const PUNCT_RE = /[\s，。？！、；：""''《》（）·—…,.?!;:'"()\-]/g;
const SYLLABLE_RE = /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/;
const countChars = (text) => [...text.replace(PUNCT_RE, '')].length;
const sortKeySeen = new Set();
const PLACEHOLDER_RE = /TODO|待补|【|】|xxx/i;

for (const { file, data: p } of poemFiles) {
  if (!Array.isArray(p.lines) || p.lines.length === 0) {
    err(file, 'lines 为空或不是数组');
    continue;
  }

  // 规则 3：拼音数 = 去标点字数，且每项合法
  p.lines.forEach((line, i) => {
    const count = countChars(line.text ?? '');
    if (!Array.isArray(line.pinyin) || line.pinyin.length !== count) {
      err(
        file,
        `第 ${i + 1} 行拼音数(${line.pinyin?.length ?? 0}) ≠ 去标点字数(${count})：「${line.text}」`
      );
      return;
    }
    line.pinyin.forEach((syl) => {
      if (!syl || !SYLLABLE_RE.test(syl)) err(file, `第 ${i + 1} 行存在非法拼音：「${syl}」`);
    });
  });

  // 规则 4：注释 id 唯一、被引用、引用存在
  const noteIds = new Set((p.notes ?? []).map((n) => n.id));
  if (noteIds.size !== (p.notes ?? []).length) err(file, 'notes 存在重复 id');
  const used = new Set();
  p.lines.forEach((line, i) => {
    for (const nid of line.noteIds ?? []) {
      used.add(nid);
      if (!noteIds.has(nid)) err(file, `第 ${i + 1} 行引用了不存在的注释：${nid}`);
    }
  });
  for (const nid of noteIds) {
    if (!used.has(nid)) err(file, `孤立注释（未被任何行引用）：${nid}`);
  }
  (p.notes ?? []).forEach((n) => {
    const parts = String(n.pinyin ?? '').split(/\s+/);
    if (parts.some((s) => !SYLLABLE_RE.test(s))) err(file, `注释「${n.word}」拼音非法：${n.pinyin}`);
  });

  // 规则 5：storyline step 连续、imageStep 可匹配
  (p.storyline ?? []).forEach((s, i) => {
    if (s.step !== i + 1) err(file, `storyline 第 ${i + 1} 项 step 应为 ${i + 1}，实际 ${s.step}`);
    if (s.imageStep != null) {
      const has = (p.images?.panels ?? []).some((pl) => pl.step === s.imageStep);
      if (!has) err(file, `storyline 第 ${s.step} 步的 imageStep ${s.imageStep} 无对应分镜图`);
    }
  });

  // 规则 6：published 必填项
  if (p.status === 'published') {
    for (const key of ['translation', 'storyline', 'sources', 'writtenLabel']) {
      if (p[key] == null || (Array.isArray(p[key]) && p[key].length === 0)) {
        err(file, `status=published 缺少 ${key}`);
      }
    }
    if (!p.images?.cover) err(file, 'status=published 缺少 images.cover');
  }

  // 规则 7：writtenYear / orderInAuthor 为数字且同作者不重复
  if (typeof p.writtenYear !== 'number') err(file, `writtenYear 必须为数字：${p.writtenYear}`);
  if (typeof p.orderInAuthor !== 'number') err(file, `orderInAuthor 必须为数字：${p.orderInAuthor}`);
  const sortKey = `${p.authorId}@${p.writtenYear}-${p.orderInAuthor}`;
  if (sortKeySeen.has(sortKey)) err(file, `同作者 (writtenYear, orderInAuthor) 重复：${sortKey}`);
  sortKeySeen.add(sortKey);

  // 规则 8：cover 文件真实存在且字段齐全
  const cover = p.images?.cover;
  if (cover) {
    if (!cover.width || !cover.height || !cover.alt) err(file, 'cover 缺少 width/height/alt');
    const coverPath = path.join(PUBLIC, cover.src.replace(/^\//, ''));
    if (!fs.existsSync(coverPath)) err(file, `cover 文件不存在：${cover.src}`);
  }

  // 规则 10：无占位符
  scanStrings(p, (v) => {
    if (PLACEHOLDER_RE.test(v)) err(file, `文本包含占位符：${v.slice(0, 30)}`);
  });
}

// ---------- 规则 9：同一作者 id 的 name/birthYear/deathYear 全站一致 ----------
const authorMeta = new Map();
for (const { file, data: a } of authorFiles) {
  const prev = authorMeta.get(a.id);
  if (prev) {
    if (prev.name !== a.name || prev.birthYear !== a.birthYear || prev.deathYear !== a.deathYear) {
      err(file, `作者 ${a.id} 的 name/birthYear/deathYear 与 ${prev.file} 不一致`);
    }
  }
  authorMeta.set(a.id, { name: a.name, birthYear: a.birthYear, deathYear: a.deathYear, file });
}

// 作者数据也做占位符扫描
for (const { file, data: a } of authorFiles) {
  scanStrings(a, (v) => {
    if (PLACEHOLDER_RE.test(v)) err(file, `文本包含占位符：${v.slice(0, 30)}`);
  });
}

// ---------- 输出 ----------
if (errors.length > 0) {
  console.error(`\n✗ 内容校验未通过，共 ${errors.length} 个问题：\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
} else {
  console.log(
    `✓ 内容校验通过：${dynasties.length} 个大类，${authorFiles.length} 位作者，${poemFiles.length} 首作品`
  );
}
