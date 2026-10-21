import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
S = 4                      # supersampling
W = 1024 * S
FONT = "/Users/varla-am/Library/Fonts/MesloLGMNerdFontMono-Bold.ttf"
BG_TOP, BG_BOT = (24, 27, 34), (12, 13, 17)
TILE = (22, 24, 29)
TEAL, PURPLE, PINK = (67, 217, 199), (138, 127, 240), (240, 166, 202)
INK = (236, 238, 242)

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
# background: vertical gradient inside a rounded square
grad = Image.new("RGBA", (W, W))
gd = ImageDraw.Draw(grad)
for y in range(W):
    t = y / W
    gd.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)) + (255,))
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=230 * S, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)
# hairline border of the icon
d.rounded_rectangle([2*S, 2*S, W - 3*S, W - 3*S], radius=228 * S, outline=(255, 255, 255, 28), width=3 * S)

def row(word, y, size, gap, colour, accent=None):
    n = len(word)
    total = n * size + (n - 1) * gap
    x = (W - total) // 2
    font = ImageFont.truetype(FONT, int(size * 0.62))
    for i, ch in enumerate(word):
        c = PINK if accent and i in accent else colour
        box = [x, y, x + size, y + size]
        # soft glow
        glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
        ImageDraw.Draw(glow).rounded_rectangle(box, radius=size * 0.26, outline=c + (110,), width=int(size * 0.06))
        img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size * 0.09)))
        dd = ImageDraw.Draw(img)
        dd.rounded_rectangle(box, radius=size * 0.26, fill=TILE + (255,), outline=c + (255,), width=int(size * 0.045))
        dd.text((x + size / 2, y + size / 2 + size * 0.02), ch, font=font, fill=c + (255,) if i == 0 else INK + (255,), anchor="mm")
        x += size + gap

size1, size2 = 168 * S, 116 * S
gap1, gap2 = 22 * S, 14 * S
block = size1 + 40 * S + size2
top = (W - block) // 2 - 30 * S
row("Cozy", top, size1, gap1, TEAL)
row("Bubbles", top + size1 + 40 * S, size2, gap2, PURPLE, accent={0})

# terminal prompt line under the tiles: ❯ in pink and a block cursor
font = ImageFont.truetype(FONT, 64 * S)
py = top + block + 70 * S
d = ImageDraw.Draw(img)
d.text((W // 2 - 60 * S, py), "❯", font=font, fill=PINK + (255,), anchor="mm")
d.rounded_rectangle([W // 2 - 10 * S, py - 34 * S, W // 2 + 30 * S, py + 34 * S], radius=6 * S, fill=INK + (230,))

img.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
