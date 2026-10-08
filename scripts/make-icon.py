# 生成应用图标 build/icon.ico：深色圆角底 + 琥珀金「译」
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'icon.ico')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

BG = (22, 26, 33, 255)
ACCENT = (242, 178, 76, 255)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)


def render(size: int) -> Image.Image:
    scale = 4
    S = size * scale
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=BG)
    if FONT_PATH:
        font = ImageFont.truetype(FONT_PATH, int(S * 0.62))
        bbox = d.textbbox((0, 0), '译', font=font)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        d.text(((S - w) / 2 - bbox[0], (S - h) / 2 - bbox[1] - S * 0.02),
               '译', font=font, fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)


sizes = [256, 128, 64, 48, 32, 16]
imgs = [render(s) for s in sizes]
imgs[0].save(OUT, format='ICO', sizes=[(s, s) for s in sizes],
             append_images=imgs[1:])
print('saved', OUT)
