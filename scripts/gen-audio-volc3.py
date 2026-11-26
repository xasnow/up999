# -*- coding: utf-8 -*-
"""
诗词朗读音频生成脚本（火山引擎·豆包语音合成 3.0 / voice.cn-beijing 新接口）

与 gen-audio-volc.py（2.0/openspeech 体系）的区别：
  - 接口域名：voice.cn-beijing.volces.com
  - 路径：/api/v3/text-to-speech/{voice_id}/streaming（voice_id 直接进 URL）
  - 响应：SSE 事件流，event=audio 的 audio 字段为 base64 音频分片

用法：
  python scripts/gen-audio-volc3.py --ids jueju-huangli --out audio-samples\\voice3-test
  python scripts/gen-audio-volc3.py            # 全量生成到 public/assets/audio/poems

密钥：复用 scripts/volc-config.local.json 的 apiKey（与 2.0 同一把）。
"""

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
POEMS_DIR = ROOT / "src" / "data" / "poems"
AUTHORS_DIR = ROOT / "src" / "data" / "authors"
CONFIG_FILE = ROOT / "scripts" / "volc-config.local.json"
DEFAULT_OUT = ROOT / "public" / "assets" / "audio" / "poems"

DEFAULT_SPEAKER = "multi_female_zhixingnv_v3_uranus_bigtts"
DEFAULT_MODEL = "doubao-seed-tts-3.0"
DEFAULT_SPEED = 0.8  # 朗诵宜放慢（0.8 实测定稿）


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        print("缺少 scripts/volc-config.local.json")
        sys.exit(1)
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def build_read_text(poem: dict, author_name: str) -> str:
    """拼装朗读文本：标题、作者、正文。"""
    parts = [f"{poem['title']}。", f"{author_name}。"]
    body = [line["text"].strip() for line in poem.get("lines", []) if line["text"].strip()]
    parts.append("\n".join(body))
    return "\n".join(parts)


def sanitize_text(text: str) -> str:
    return text.replace("——", "，").replace("—", "，").replace("……", "。")


def prepend_silence(path: Path, ms: int) -> None:
    """用 ffmpeg 在音频开头拼接 ms 毫秒静音（imageio-ffmpeg 自带二进制，无需单独安装）。"""
    import subprocess
    import tempfile

    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    # 统一重采样到 24kHz 单声道后拼接，避免输入输出参数不一致导致 concat 失败
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
    tmp.close()
    cmd = [
        ffmpeg, "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", f"anullsrc=r=24000:cl=mono", "-t", f"{ms / 1000:.2f}",
        "-i", str(path),
        "-filter_complex",
        "[0:a]aresample=24000[a0];[1:a]aresample=24000,aformat=channel_layouts=mono[a1];[a0][a1]concat=n=2:v=0:a=1",
        "-c:a", "libmp3lame", "-q:a", "3", tmp.name,
    ]
    subprocess.run(cmd, check=True)
    tmp_size = Path(tmp.name).stat().st_size
    if tmp_size < 1024:
        Path(tmp.name).unlink()
        raise RuntimeError("ffmpeg 处理后文件异常")
    Path(tmp.name).replace(path)


# 开头停顿：0 为不拼接静音（2026-11-26 定稿：3.0 知性女声语速 0.8，无静音前缀）
LEAD_SILENCE_MS = 0


async def synth_session(session: aiohttp.ClientSession, api_key: str, speaker: str,
                        model_id: str, speed: float, text: str, out_file: Path) -> None:
    """调用 3.0 流式接口，event=audio 的 base64 分片拼接为 MP3。"""
    url = f"https://voice.cn-beijing.volces.com/api/v3/text-to-speech/{speaker}/streaming"
    payload = {
        "text": text,
        "model_id": model_id,
        "enable_subtitle": False,
    }
    # 语速参数在 voice_settings.speed（0.5~2.0），顶层 speed 会被忽略
    if speed and speed != 1.0:
        payload["voice_settings"] = {"speed": speed}

    headers = {
        "X-Api-Key": api_key,
        "X-Api-Request-Id": str(uuid.uuid4()),
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    import base64
    chunks = []
    async with session.post(url, headers=headers, json=payload) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"HTTP {resp.status}: {body[:300]}")
        # SSE：事件行 event: xxx / 数据行 data: {...}，或整行 JSON；两种都兼容
        buf = []
        async for raw in resp.content:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            if line.startswith("data:"):
                obj_text = line[5:].strip()
            elif line.startswith("event:"):
                buf.append(line[6:].strip())
                continue
            else:
                obj_text = line
            try:
                obj = json.loads(obj_text)
            except json.JSONDecodeError:
                continue
            buf.clear()
            if obj.get("event") == "audio" and obj.get("audio"):
                chunks.append(base64.b64decode(obj["audio"]))
            elif obj.get("event") == "error" or obj.get("code") not in (0, None, 20000000):
                raise RuntimeError(f"接口返回错误：{json.dumps(obj, ensure_ascii=False)[:300]}")
        if not chunks:
            raise RuntimeError("未收到音频数据（No audio was received）")
        out_file.write_bytes(b"".join(chunks))


async def main() -> None:
    parser = argparse.ArgumentParser(description="豆包语音合成 3.0 生成诗词朗读音频")
    parser.add_argument("--ids", help="作品 slug 列表，逗号分隔；缺省为全部已发布作品")
    parser.add_argument("--speaker", default=DEFAULT_SPEAKER, help="音色 ID（进 URL 路径）")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="模型 ID")
    parser.add_argument("--speed", type=float, default=DEFAULT_SPEED, help="语速")
    parser.add_argument("--silence", type=int, default=LEAD_SILENCE_MS, help="开头静音毫秒数，0 为不加")
    parser.add_argument("--force", action="store_true", help="强制重新生成已存在的音频（换音色/语速时用）；缺省跳过已存在的文件")
    parser.add_argument("--text", help="自定义朗读文本（调试用）；不传则按作品数据生成")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="输出目录")
    args = parser.parse_args()

    config = load_config()
    api_key = config["apiKey"]

    wanted = set(args.ids.split(",")) if args.ids else None
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    tasks = []
    skipped = []
    if args.text:
        # 自定义文本调试模式：固定输出 custom.mp3
        tasks = [("自定义文本", out_dir / "custom.mp3", args.text)]
    else:
        for pf in sorted(POEMS_DIR.glob("*.json")):
            poem = json.loads(pf.read_text(encoding="utf-8"))
            if poem.get("status") != "published":
                continue
            if wanted and poem["slug"] not in wanted:
                continue
            author = json.loads((AUTHORS_DIR / f"{poem['authorId']}.json").read_text(encoding="utf-8"))
            text = sanitize_text(build_read_text(poem, author["name"]))
            out_file = out_dir / f"{poem['slug']}.mp3"
            # 增量模式：文件已存在且未指定 --force 时跳过，只处理新增作品，不重复消耗额度
            if out_file.exists() and not args.force:
                skipped.append(poem["title"])
                continue
            # 额度控制：新批次（no>=1000）作品朗读文本超过 100 字暂缓，等额度充足后用 --ids 指定补齐
            if poem.get("no", 0) >= 1000 and len(text) > 100:
                skipped.append(f"{poem['title']}(>100字暂缓)")
                continue
            tasks.append((poem["title"], out_file, text))

    if not tasks and not skipped:
        print("没有匹配的作品，检查 --ids 参数或作品 status 是否为 published")
        sys.exit(1)

    print(f"待生成 {len(tasks)} 个，跳过已存在 {len(skipped)} 个")
    ok = 0
    fail = []
    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for title, out_file, text in tasks:
            try:
                await synth_session(session, api_key, args.speaker, args.model, args.speed, text, out_file)
                if args.silence > 0:
                    await asyncio.to_thread(prepend_silence, out_file, args.silence)
                print(f"  ✓ {title} -> {out_file.name}（{out_file.stat().st_size // 1024} KB）")
                ok += 1
            except Exception as e:
                print(f"  ✗ {title} 生成失败：{e}")
                fail.append(title)
    print(f"完成：{ok}/{len(tasks)}")
    if fail:
        print("失败清单：" + ", ".join(fail))


if __name__ == "__main__":
    asyncio.run(main())
