#!/usr/bin/env python3
# 生成 Aker 应用图标主图（1024×1024 PNG）：品牌色圆角方块 + 白色 A，透明边距（macOS squircle 风格）
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
CLAY = (217, 119, 87, 255)   # #d97757 品牌黏土橙
WHITE = (255, 255, 255, 255)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角方块（留边距，约 80% 占比，圆角 ~23%）
m = 112                      # margin
box = [m, m, SIZE - m, SIZE - m]
radius = int((SIZE - 2 * m) * 0.235)
d.rounded_rectangle(box, radius=radius, fill=CLAY)

# 选一个尽量粗的字体画 A
candidates = [
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
    ("/System/Library/Fonts/Helvetica.ttc", 1),
    ("/System/Library/Fonts/Helvetica.ttc", 0),
    ("/System/Library/Fonts/SFNS.ttf", 0),
    ("/Library/Fonts/Arial Bold.ttf", 0),
]
font = None
fsize = 560
for path, idx in candidates:
    try:
        font = ImageFont.truetype(path, fsize, index=idx)
        used = path
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()
    used = "default"

# 描边加粗，确保视觉够重；居中
sw = int(fsize * 0.03)
bbox = d.textbbox((0, 0), "A", font=font, stroke_width=sw)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
cx, cy = SIZE / 2, SIZE / 2
x = cx - tw / 2 - bbox[0]
y = cy - th / 2 - bbox[1]
d.text((x, y), "A", font=font, fill=WHITE, stroke_width=sw, stroke_fill=WHITE)

out = __file__.rsplit("/", 1)[0] + "/icon-1024.png"
img.save(out)
print(f"✔ {out}  (font={used})")
