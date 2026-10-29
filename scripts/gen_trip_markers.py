# 生成行程编号标记 num-7..num-20（与 num-1..6 同款：60x76，白圈+红底+红色尾巴+白色数字）
# 用法：python scripts/gen_trip_markers.py [起始号] [结束号]
import os, sys
from PIL import Image, ImageDraw, ImageFont

S = 4                      # 超采样倍数
W, H = 60, 76              # 与 num-1..6 一致
RED = (176, 57, 46, 255)   # #b0392e
WHITE = (255, 255, 255, 255)
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
]
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "miniprogram", "assets", "marker")


def _font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("no bold CJK/latin font found")


def render(num, font_path):
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = 30 * S, 27 * S
    d.ellipse([cx - 102, cy - 102, cx + 102, cy + 102], fill=WHITE)     # 白描边圆
    d.ellipse([cx - 84, cy - 84, cx + 84, cy + 84], fill=RED)           # 红底圆
    d.polygon([(88, 200), (152, 200), (120, 294)], fill=RED)            # 红色尾巴
    text = str(num)
    target_h = 64 if len(text) == 1 else 50
    size = 90 if len(text) == 1 else 70
    for _ in range(3):
        f = ImageFont.truetype(font_path, size)
        bbox = f.getbbox(text)
        size = max(8, int(round(size * target_h / (bbox[3] - bbox[1]))))
    f = ImageFont.truetype(font_path, size)
    bbox = f.getbbox(text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=f, fill=WHITE)
    return im.resize((W, H), Image.LANCZOS)


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    font_path = _font_path()
    if not os.path.isdir(OUT_DIR):
        raise SystemExit("missing dir: " + OUT_DIR)
    for n in range(start, end + 1):
        path = os.path.join(OUT_DIR, "num-%d.png" % n)
        render(n, font_path).save(path)
        print("wrote num-%d.png %d bytes" % (n, os.path.getsize(path)))


if __name__ == "__main__":
    main()
