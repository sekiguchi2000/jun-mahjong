# make_icon.py — アプリアイコン生成 (中スタイルの牌)
from PIL import Image, ImageDraw, ImageFont

def make(size, path):
    img = Image.new('RGBA', (size, size), (11, 61, 46, 255))  # 深緑
    d = ImageDraw.Draw(img)
    # 背景の淡いグラデ風
    for i in range(size):
        a = int(20 * (1 - i / size))
        d.line([(0, i), (size, i)], fill=(20 + a, 87 + a, 63 + a, 255))
    # 牌
    m = size * 0.16
    x0, y0, x1, y1 = m, m * 0.85, size - m, size - m * 0.85
    r = size * 0.08
    d.rounded_rectangle([x0 + size*0.015, y0 + size*0.03, x1 + size*0.015, y1 + size*0.03], radius=r, fill=(90, 88, 70, 255))
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=(250, 249, 240, 255), outline=(185, 181, 160, 255), width=max(1, size // 128))
    # 「中」の字
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/msgothic.ttc', int(size * 0.42))
    except OSError:
        font = ImageFont.truetype('C:/Windows/Fonts/meiryo.ttc', int(size * 0.42))
    text = '中'
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=(176, 50, 44, 255))
    img.save(path)
    print(path)

import os
os.makedirs('icons', exist_ok=True)
make(192, 'icons/icon-192.png')
make(512, 'icons/icon-512.png')
make(180, 'icons/apple-touch-icon.png')
