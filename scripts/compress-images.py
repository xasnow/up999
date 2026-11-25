# -*- coding: utf-8 -*-
"""
诗词配图批量压缩脚本

功能：
  遍历 public/assets/img/poems/*.jpg，等比缩小到目标最大宽度（默认 1120px，约为原图 2240 的 50%），
  并以渐进式 JPEG、质量 80 重新编码，总体积可下降 60%~80%。

用法：
  python scripts/compress-images.py            # 处理全部图片（跳过已小于目标的）
  python scripts/compress-images.py --width 900 --quality 75

注意：
  处理会覆盖原文件，且无法恢复原图。如需保留原图，先备份 public/assets/img/poems。
"""

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "public" / "assets" / "img" / "poems"


def main() -> None:
    parser = argparse.ArgumentParser(description="批量压缩诗词配图")
    parser.add_argument("--width", type=int, default=1120, help="目标最大宽度，默认 1120px")
    parser.add_argument("--quality", type=int, default=80, help="JPEG 质量，默认 80")
    args = parser.parse_args()

    files = sorted(IMG_DIR.glob("*.jpg"))
    if not files:
        print(f"未找到图片：{IMG_DIR}")
        return

    before_total = 0
    after_total = 0
    skipped = 0
    for f in files:
        before = f.stat().st_size
        before_total += before
        img = Image.open(f)
        # 已小于目标宽度且体积不大的直接跳过，避免重复编码损失
        if img.width <= args.width and before < 200 * 1024:
            skipped += 1
            after_total += before
            continue
        if img.width > args.width:
            height = round(img.height * args.width / img.width)
            img = img.resize((args.width, height), Image.LANCZOS)
        # 转为 RGB（JPEG 不支持透明通道），渐进式编码
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(f, "JPEG", quality=args.quality, optimize=True, progressive=True)
        after = f.stat().st_size
        after_total += after
        print(f"  {f.name}: {before // 1024}KB -> {after // 1024}KB ({img.width}x{img.height})")

    print(f"完成：{len(files)} 张（跳过 {skipped} 张），"
          f"{before_total // 1024}KB -> {after_total // 1024}KB，"
          f"压缩率 {100 - after_total * 100 // before_total}%")


if __name__ == "__main__":
    main()
