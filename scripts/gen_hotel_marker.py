# -*- coding: utf-8 -*-
"""
生成「酒店」分类图钉（60x76，与 scenic/school/food 等分类图钉同一形状）。

做法：拿现成的 school.png（蓝 #3a6ea5）做基版，把主色重映射成酒店紫 #6f548f。
每个不透明像素都视为「主色 ↔ 白」之间的混合，按混合比例 t 换成「酒店紫 ↔ 白」，
这样抗锯齿边缘、白色外圈、中间白点全部保持原样，轮廓与其它分类图钉完全一致。

用法：
    python scripts/gen_hotel_marker.py
输出：
    miniprogram/assets/marker/hotel.png
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'miniprogram', 'assets', 'marker', 'school.png')
DST = os.path.join(ROOT, 'miniprogram', 'assets', 'marker', 'hotel.png')

SRC_ACCENT = (58, 110, 165)   # school.png 的蓝
DST_ACCENT = (111, 84, 143)   # 酒店紫 #6f548f
WHITE = (255, 255, 255)


def recolor_pixel(px):
    r, g, b, a = px
    if a == 0:
        return px
    # 求每个通道的混合比例 t：p = white + t * (accent - white)
    ratios = []
    for i, channel in enumerate((r, g, b)):
        denom = SRC_ACCENT[i] - 255.0
        if abs(denom) < 1e-6:
            continue
        ratios.append((channel - 255.0) / denom)
    if not ratios:
        return px
    ratios.sort()
    t = ratios[len(ratios) // 2]
    if t < 0:
        t = 0.0
    if t > 1:
        t = 1.0
    out = tuple(int(round(255 + t * (DST_ACCENT[i] - 255.0))) for i in range(3))
    return (out[0], out[1], out[2], a)


def main():
    src = Image.open(SRC).convert('RGBA')
    dst = Image.new('RGBA', src.size, (0, 0, 0, 0))
    w, h = src.size
    pour = dst.load()
    for y in range(h):
        for x in range(w):
            pour[x, y] = recolor_pixel(src.getpixel((x, y)))
    dst.save(DST)
    print('saved', DST, dst.size)


if __name__ == '__main__':
    main()