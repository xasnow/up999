# -*- coding: utf-8 -*-
"""
诗词朗读音频生成脚本（基于 Edge-TTS 免费神经网络语音）

功能：
  1. 读取 src/data/poems/*.json 与 src/data/authors/*.json
  2. 按"标题、作者、正文"拼装朗读文本，句间/节间加入停顿控制
  3. 调用 edge-tts 合成 MP3，输出到 public/assets/audio/poems/{slug}-{voice简称}.mp3

用法：
  # 生成指定作品（按 slug），默认全部已发布作品
  python scripts/gen-audio.py --ids jingyesi,mashi,shuidiaogetou

  # 指定音色与语速（语速用百分比，负数放慢）
  python scripts/gen-audio.py --voice zh-CN-XiaoxiaoNeural --rate -15%

  # 指定输出目录（默认 public/assets/audio/poems）
  python scripts/gen-audio.py --out audio-samples

常用音色：
  zh-CN-XiaoxiaoNeural  晓晓（女声，温暖自然）
  zh-CN-YunjianNeural   云健（男声，浑厚沉稳，适合朗诵）
  zh-CN-YunxiNeural     云希（男声，年轻清亮）
  zh-CN-XiaoyiNeural    晓伊（女声，偏少女感）
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

import edge_tts

# 项目根目录（scripts/ 的上一级）
ROOT = Path(__file__).resolve().parent.parent
POEMS_DIR = ROOT / "src" / "data" / "poems"
AUTHORS_DIR = ROOT / "src" / "data" / "authors"
DEFAULT_OUT = ROOT / "public" / "assets" / "audio" / "poems"

# 音色文件名简称（避免文件名过长）
VOICE_TAGS = {
    "zh-CN-XiaoxiaoNeural": "xx",
    "zh-CN-YunjianNeural": "yj",
    "zh-CN-YunxiNeural": "yx",
    "zh-CN-XiaoyiNeural": "xy",
    "zh-CN-YunyangNeural": "yy",
}

# 朗读语速：诗词宜放慢，默认 -15%
DEFAULT_RATE = "-15%"


def build_read_text(poem: dict, author_name: str) -> str:
    """拼装朗读文本：标题、作者、正文，标点自带自然停顿。

    规则：
      - 标题里的括号补充（如"其五""节选"）保留，TTS 会作为停顿自然带过
      - 句与句之间换行，行末标点产生句读停顿
      - 节与节之间（空行）产生更长的停顿
    """
    title = poem["title"].strip()
    # 标题末尾加句号，制造标题与作者之间的停顿
    parts = [f"{title}。", f"{author_name}。"]
    # 正文：按行朗读，TTS 对换行和句末标点都有自然停顿
    body = []
    for line in poem.get("lines", []):
        text = line["text"].strip()
        if text:
            body.append(text)
    parts.append("\n".join(body))
    return "\n".join(parts)


def sanitize_text(text: str) -> str:
    """清理 TTS 不友好字符：中文破折号、省略号统一处理，避免读出符号名。"""
    text = text.replace("——", "，").replace("—", "，")
    text = text.replace("……", "。")
    return text


def pick_voice_tag(voice: str) -> str:
    return VOICE_TAGS.get(voice, voice.replace("zh-CN-", "").replace("Neural", "").lower())


async def synth(text: str, voice: str, rate: str, out_file: Path) -> None:
    """合成单个音频文件。"""
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(str(out_file))


async def main() -> None:
    parser = argparse.ArgumentParser(description="生成诗词朗读音频")
    parser.add_argument("--ids", help="作品 slug 列表，逗号分隔；缺省为全部已发布作品")
    parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural", help="TTS 音色")
    parser.add_argument("--rate", default=DEFAULT_RATE, help="语速，如 -15%%")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录")
    args = parser.parse_args()

    wanted = set(args.ids.split(",")) if args.ids else None
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    voice_tag = pick_voice_tag(args.voice)

    poem_files = sorted(POEMS_DIR.glob("*.json"))
    tasks = []
    skipped = 0
    for pf in poem_files:
        poem = json.loads(pf.read_text(encoding="utf-8"))
        # 只处理已发布作品；指定 ids 时只处理命中的 slug
        if poem.get("status") != "published":
            continue
        if wanted and poem["slug"] not in wanted:
            continue
        author_file = AUTHORS_DIR / f"{poem['authorId']}.json"
        author = json.loads(author_file.read_text(encoding="utf-8"))
        text = sanitize_text(build_read_text(poem, author["name"]))
        out_file = out_dir / f"{poem['slug']}-{voice_tag}.mp3"
        tasks.append((poem["title"], out_file, text))

    if not tasks:
        print("没有匹配的作品，检查 --ids 参数或作品 status 是否为 published")
        sys.exit(1)

    print(f"共 {len(tasks)} 个音频待生成，音色={args.voice}，语速={args.rate}")
    ok = 0
    for title, out_file, text in tasks:
        try:
            await synth(text, args.voice, args.rate, out_file)
            size_kb = out_file.stat().st_size // 1024
            print(f"  ✓ {title} -> {out_file.name}（{size_kb} KB）")
            ok += 1
        except Exception as e:  # 单个失败不中断整批
            print(f"  ✗ {title} 生成失败：{e}")
    print(f"完成：{ok}/{len(tasks)}")


if __name__ == "__main__":
    asyncio.run(main())
