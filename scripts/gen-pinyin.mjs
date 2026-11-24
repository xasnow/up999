#!/usr/bin/env node
/**
 * 离线拼音初稿生成工具（pinyin-pro 仅作编辑工具，不进入前端产物）
 *
 * 用法：
 *   node scripts/gen-pinyin.mjs src/data/poems/xxx.json          # 仅报告缺口
 *   node scripts/gen-pinyin.mjs src/data/poems/xxx.json --write  # 回填缺失的拼音
 *
 * 说明：
 * - 只填充 pinyin 数组中缺失/非法的项，已有内容不覆盖；
 * - 多音字与变调必须人工校对（对照 src/data/pinyin-overrides.json）。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const fileArg = args.find((a) => !a.startsWith('--'));

if (!fileArg) {
  console.error('用法：node scripts/gen-pinyin.mjs <poem.json 路径> [--write]');
  process.exit(1);
}

const PUNCT_RE = /[\s，。？！、；：""''《》（）·—…,.?!;:'"()\-]/g;

async function main() {
  let pinyinPro;
  try {
    pinyinPro = await import('pinyin-pro');
  } catch {
    console.error('未安装 pinyin-pro，请先执行：npm install');
    process.exit(1);
  }

  const { pinyin } = pinyinPro;
  const abs = path.isAbsolute(fileArg) ? fileArg : path.join(ROOT, fileArg);
  const poem = JSON.parse(fs.readFileSync(abs, 'utf8'));
  let filled = 0;

  poem.lines.forEach((line, li) => {
    const chars = [...(line.text ?? '').replace(PUNCT_RE, '')];
    if (!Array.isArray(line.pinyin)) line.pinyin = [];

    // 逐字生成初稿（注意：多音字可能出错，仅作初稿）
    const draft = chars.map((ch) =>
      pinyin(ch, { toneType: 'symbol', type: 'string', nonzhian: 'consecutive' }).trim()
    );

    if (line.pinyin.length !== chars.length) {
      console.warn(`第 ${li + 1} 行长度不一致：pinyin=${line.pinyin.length}，字数=${chars.length}`);
    }
    if (write) {
      // 回填策略：以初稿对齐重建，再保留人工已填且合法的读音
      line.pinyin = chars.map((ch, i) => {
        const old = line.pinyin[i];
        const ok = typeof old === 'string' && /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/.test(old);
        if (!ok) filled++;
        return ok ? old : draft[i] ?? '';
      });
    }
  });

  if (write) {
    fs.writeFileSync(abs, JSON.stringify(poem, null, 2) + '\n', 'utf8');
    console.log(`✓ 已回填 ${filled} 个拼音初稿 → ${path.relative(ROOT, abs)}`);
    console.log('⚠ 初稿由 pinyin-pro 生成，多音字/变调必须人工校对后再发布。');
  } else {
    console.log('（预览模式，未写回文件；加 --write 回填缺失拼音）');
  }
}

main();
