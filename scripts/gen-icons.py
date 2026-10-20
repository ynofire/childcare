#!/usr/bin/env python3
"""앱 아이콘·스플래시를 www/icon.svg 와 같은 모양(남색 바탕 + 동전)으로 그려서 android/ 리소스에 쓴다. (Pillow 필요)
사용: python3 scripts/gen-icons.py   — 결과물은 커밋돼 있으니 디자인을 바꿀 때만 다시 실행하세요."""
import os, glob
from PIL import Image, ImageDraw

NAVY, GOLD = (15, 23, 41, 255), (246, 196, 69, 255)
RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
SS = 4  # 슈퍼샘플링(부드러운 가장자리)

def coin(size, scale, bg=None):
    """size x size 캔버스 중앙에 동전. scale = 동전 지름 / size."""
    S = size * SS
    img = Image.new('RGBA', (S, S), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, r = S / 2, S * scale / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=GOLD)
    ri = r * (14 / 19)
    d.ellipse([c - ri, c - ri, c + ri, c + ri], outline=NAVY, width=max(1, int(r * 2.5 / 19)))
    w = max(1, int(r * 3 / 19)); u = r / 19
    for (x1, y1, x2, y2) in [(-6, -6, 6, -6), (-6, 0, 6, 0), (0, -6, 0, 8)]:
        d.line([c + x1 * u, c + y1 * u, c + x2 * u, c + y2 * u], fill=NAVY, width=w)
        for (px, py) in [(x1, y1), (x2, y2)]:
            d.ellipse([c + px * u - w / 2, c + py * u - w / 2, c + px * u + w / 2, c + py * u + w / 2], fill=NAVY)
    return img.resize((size, size), Image.LANCZOS)

def save(img, path): os.makedirs(os.path.dirname(path), exist_ok=True); img.save(path)

legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
fore = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
for k, px in legacy.items():
    sq = coin(px, 0.60, bg=NAVY)
    mask = Image.new('L', (px, px), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 0.22), fill=255)
    out = Image.new('RGBA', (px, px), (0, 0, 0, 0)); out.paste(sq, (0, 0), mask)
    save(out, f'{RES}/mipmap-{k}/ic_launcher.png')
    rnd = Image.new('L', (px, px), 0); ImageDraw.Draw(rnd).ellipse([0, 0, px - 1, px - 1], fill=255)
    out2 = Image.new('RGBA', (px, px), (0, 0, 0, 0)); out2.paste(sq, (0, 0), rnd)
    save(out2, f'{RES}/mipmap-{k}/ic_launcher_round.png')
for k, px in fore.items():
    save(coin(px, 0.50), f'{RES}/mipmap-{k}/ic_launcher_foreground.png')  # 적응형 아이콘 안전 영역 안에 들어오게 작게

with open(f'{RES}/drawable/ic_launcher_background.xml', 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <solid android:color="#0F1729" />\n</shape>\n')

for p in glob.glob(f'{RES}/drawable*/splash.png'):
    w, h = Image.open(p).size
    base = Image.new('RGBA', (w, h), NAVY)
    s = int(min(w, h) * 0.32)
    base.alpha_composite(coin(s, 1.0), ((w - s) // 2, (h - s) // 2))
    base.convert('RGB').save(p)
print('icons ok')
