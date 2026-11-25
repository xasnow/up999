# -*- coding: utf-8 -*-
"""
诗词朗读音频生成脚本（火山引擎·豆包语音合成大模型 V3）

功能：
  1. 读取 src/data/poems/*.json 与 authors/*.json，拼装"标题、作者、正文"朗读文本
  2. 调用火山引擎 V3 HTTP 接口合成 MP3
  3. 输出到 public/assets/audio/poems/{slug}.mp3（与作品 slug 一一对应，前端按此路径播放）

用法：
  # 生成指定作品（按 slug）
  python scripts/gen-audio-volc.py --ids jingyesi,mashi

  # 指定音色与语速（speed_ratio <1 放慢，>1 加快）
  python scripts/gen-audio-volc.py --speaker ICL_uranus_zh_female_wenrouwenya_tob --speed 0.85

  # 指定输出目录
  python scripts/gen-audio-volc.py --out audio-samples

密钥：从 scripts/volc-config.local.json 读取 apiKey（不入仓库）。
资源 ID：默认 seed-tts-2.0；如音色属于声音复刻(ICL 前缀)，用 --resource seed-icl-2.0。
"""

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

import aiohttp  # pip install aiohttp；如缺失自动回退 requests

ROOT = Path(__file__).resolve().parent.parent
POEMS_DIR = ROOT / "src" / "data" / "poems"
AUTHORS_DIR = ROOT / "src" / "data" / "authors"
CONFIG_FILE = ROOT / "scripts" / "volc-config.local.json"
DEFAULT_OUT = ROOT / "public" / "assets" / "audio" / "poems"
API_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

DEFAULT_SPEAKER = "ICL_uranus_zh_female_wenrouwenya_tob"
DEFAULT_SPEED = 0.85  # 朗诵宜放慢


def load_config() -> dict:
    """读取本地密钥配置（gitignore 保护，不入仓库）。"""
    if not CONFIG_FILE.exists():
        print("缺少 scripts/volc-config.local.json，请先配置 apiKey")
        sys.exit(1)
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def build_read_text(poem: dict, author_name: str) -> str:
    """拼装朗读文本：标题、作者、正文；句末标点自带停顿。"""
    parts = [f"{poem['title']}。", f"{author_name}。"]
    body = [line["text"].strip() for line in poem.get("lines", []) if line["text"].strip()]
    parts.append("\n".join(body))
    return "\n".join(parts)


def sanitize_text(text: str) -> str:
    """清理 TTS 不友好符号。"""
    return text.replace("——", "，").replace("—", "，").replace("……", "。")


async def synth_session(session: aiohttp.ClientSession, api_key: str, resource_id: str,
                        speaker: str, speed: float, text: str, out_file: Path) -> None:
    """调用 V3 单向流式接口，把分片 base64 音频拼接为 MP3。"""
    payload = {
        "user": {"uid": "up999-poetry"},
        "req_params": {
            "speaker": speaker,
            "text": text,
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
                "speed_ratio": speed,
            },
        },
    }
    headers = {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": str(uuid.uuid4()),
        "Content-Type": "application/json",
    }
    async with session.post(API_URL, headers=headers, json=payload) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"HTTP {resp.status}: {body[:300]}")
        chunks = []
        # 响应为按行分隔的 JSON，每行 data 字段携带 base64 音频分片
        async for raw in resp.content:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            # code=0 为数据帧；code=20000000 为正常结束帧；其余为错误帧
            code = obj.get("code")
            if code is not None and code not in (0, 20000000):
                raise RuntimeError(f"接口返回错误 code={code} message={obj.get('message')}")
            data = obj.get("data")
            if data:
                import base64
                chunks.append(base64.b64decode(data))
            if code == 20000000:
                break
        if not chunks:
            raise RuntimeError("未收到音频数据（No audio was received）")
        out_file.write_bytes(b"".join(chunks))


async def main() -> None:
    parser = argparse.ArgumentParser(description="火山引擎生成诗词朗读音频")
    parser.add_argument("--ids", help="作品 slug 列表，逗号分隔；缺省为全部已发布作品")
    parser.add_argument("--speaker", default=DEFAULT_SPEAKER, help="音色代码")
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED, help="语速 0.2~3.0，<1 放慢")
    parser.add_argument("--resource", default=None, help="X-Api-Resource-Id，缺省取配置文件")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录")
    args = parser.parse_args()

    config = load_config()
    api_key = config["apiKey"]
    resource_id = args.resource or config.get("resourceId", "seed-tts-2.0")

    wanted = set(args.ids.split(",")) if args.ids else None
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    tasks = []
    for pf in sorted(POEMS_DIR.glob("*.json")):
        poem = json.loads(pf.read_text(encoding="utf-8"))
        if poem.get("status") != "published":
            continue
        if wanted and poem["slug"] not in wanted:
            continue
        author = json.loads((AUTHORS_DIR / f"{poem['authorId']}.json").read_text(encoding="utf-8"))
        text = sanitize_text(build_read_text(poem, author["name"]))
        tasks.append((poem["title"], out_dir / f"{poem['slug']}.mp3", text))

    if not tasks:
        print("没有匹配的作品，检查 --ids 参数或作品 status 是否为 published")
        sys.exit(1)

    print(f"共 {len(tasks)} 个音频待生成，音色={args.speaker}，语速={args.speed}，资源={resource_id}")
    ok = 0
    fail = []
    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for title, out_file, text in tasks:
            try:
                await synth_session(session, api_key, resource_id, args.speaker, args.speed, text, out_file)
                print(f"  ✓ {title} -> {out_file.name}（{out_file.stat().st_size // 1024} KB）")
                ok += 1
            except Exception as e:
                # 首个失败时补充原因提示，便于判断资源 ID / 音色是否匹配
                print(f"  ✗ {title} 生成失败：{e}")
                fail.append(title)
    print(f"完成：{ok}/{len(tasks)}")
    if fail:
        print("失败清单：" + ", ".join(fail))


if __name__ == "__main__":
    asyncio.run(main())
