# /** THIS FILE DOES: rasterizes the globe favicon to favicon.ico (16/32/48) + PNG app icons, ROLE: Automation, MAINTAINER NOTE: one-off dev tool (needs Pillow: pip install pillow), not run in CI; geometry mirrors assets/icons/favicon.svg, re-run after changing it. **/
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def globe(size, pad=0.0):
    S = 4  # supersample for smooth edges
    n = size * S
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = n / 64 * (1 - 2 * pad)
    o = n * pad
    p = lambda v: o + v * k
    # vertical gradient disc
    top, bot = (0x3F, 0xA9, 0xFF), (0x00, 0x60, 0xDF)
    grad = Image.new('RGBA', (n, n))
    gd = ImageDraw.Draw(grad)
    for y in range(n):
        t = min(max((y - p(2)) / (p(62) - p(2)), 0), 1)
        gd.line([(0, y), (n, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bot)) + (255,))
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).ellipse([p(2), p(2), p(62), p(62)], fill=255)
    img.paste(grad, (0, 0), mask)
    # small sizes get thicker strokes so the lines survive 16px
    w = round((5 if size <= 16 else 4 if size <= 32 else 3.5) * k)
    white = (255, 255, 255, 255)
    lines = [((32, 3.5), (32, 60.5)), ((3.5, 32), (60.5, 32))]
    if size > 16:
        lines += [((7.5, 18), (56.5, 18)), ((7.5, 46), (56.5, 46))]
    for a, b in lines:
        d.line([p(a[0]), p(a[1]), p(b[0]), p(b[1])], fill=white, width=w)
    d.ellipse([p(20), p(3.5), p(44), p(60.5)], outline=white, width=w)
    d.ellipse([p(3.5), p(3.5), p(60.5), p(60.5)], outline=white, width=w)
    return img.resize((size, size), Image.LANCZOS)


def solid(img, bg=(245, 245, 247, 255)):
    # iOS/Android masks icons themselves; give them an opaque square with the globe inset
    base = Image.new('RGBA', img.size, bg)
    base.alpha_composite(img)
    return base.convert('RGB')


icons = os.path.join(ROOT, 'assets', 'icons')
os.makedirs(icons, exist_ok=True)
globe(48).save(os.path.join(ROOT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)],
               append_images=[globe(16), globe(32)])
globe(32).save(os.path.join(icons, 'favicon-32.png'), optimize=True)
solid(globe(180, pad=0.1)).save(os.path.join(icons, 'apple-touch-icon.png'), optimize=True)
solid(globe(192, pad=0.1)).save(os.path.join(icons, 'icon-192.png'), optimize=True)
solid(globe(512, pad=0.1)).save(os.path.join(icons, 'icon-512.png'), optimize=True)
print('icons written')
