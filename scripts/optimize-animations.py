"""
Downscale the RepDB preview animations for mobile.

The bundle ships them at 960x960, ~48 MB total, which is far more than a phone
hero needs. This rewrites them at 512x512 preserving per-frame timing and the
alpha channel (the classic style has a transparent background).

Usage (needs Pillow):  python scripts/optimize-animations.py SRC_DIR DST_DIR
"""

import os
import sys

from PIL import Image, ImageSequence

SIZE = 512
QUALITY = 70


def optimize(src_path: str, dst_path: str) -> tuple[int, int]:
    im = Image.open(src_path)
    frames, durations = [], []
    for frame in ImageSequence.Iterator(im):
        frames.append(frame.convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS))
        # Per-frame duration lives on the frame, not the container; dropping it
        # would flatten the animation to a uniform tempo.
        durations.append(frame.info.get("duration", 60))

    frames[0].save(
        dst_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        quality=QUALITY,
        method=4,
    )
    return os.path.getsize(src_path), os.path.getsize(dst_path)


def main() -> None:
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    os.makedirs(dst_dir, exist_ok=True)
    total_in = total_out = 0
    for name in sorted(os.listdir(src_dir)):
        if not name.endswith(".webp"):
            continue
        before, after = optimize(
            os.path.join(src_dir, name), os.path.join(dst_dir, name)
        )
        total_in += before
        total_out += after
        print(f"{name:38s} {before / 1e6:6.2f} MB -> {after / 1e6:5.2f} MB")
    print(f"\nTOTAL {total_in / 1e6:.1f} MB -> {total_out / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
