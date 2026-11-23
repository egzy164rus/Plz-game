from PIL import Image, ImageDraw, ImageFilter, ImageFont

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

TOP, BOT = (123, 47, 247), (43, 16, 84)   # фиолетовый градиент ПВЗ

def base(size, pad_ratio):
    S = size
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(S * pad_ratio)
    grad = Image.new('RGB', (1, S - 2 * pad))
    for y in range(S - 2 * pad):
        grad.putpixel((0, y), lerp(TOP, BOT, y / (S - 2 * pad)))
    grad = grad.resize((S - 2 * pad, S - 2 * pad))
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.22), fill=255)
    img.paste(grad, (pad, pad), mask.crop((pad, pad, S - pad, S - pad)))
    return img, d, S

def draw_box(d, S, k=1.0):
    cx, cy = S * 0.5, S * 0.54
    w, h = S * 0.46 * k, S * 0.34 * k
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    yellow = (255, 214, 10)
    d.rounded_rectangle([x0, y0, x1, y1], radius=S * 0.035, fill=yellow, outline=(120, 84, 0), width=max(2, int(S * 0.012)))
    d.rectangle([cx - S * 0.045 * k, y0, cx + S * 0.045 * k, y1], fill=(255, 181, 0))  # лента вертикальная
    d.rectangle([x0, cy - S * 0.028 * k, x1, cy + S * 0.028 * k], fill=(255, 181, 0))  # лента горизонтальная
    d.polygon([(cx, cy - S * 0.055), (cx - S * 0.033, cy + S * 0.012), (cx - S * 0.008, cy + S * 0.012),
               (cx - S * 0.038, cy + S * 0.075), (cx + S * 0.045, cy - S * 0.012), (cx + S * 0.008, cy - S * 0.012),
               (cx + S * 0.032, cy - S * 0.055)], fill=(23, 18, 31))  # молния — ПВЗ-энергия

def sparkle(d, cx, cy, r):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255))

def make(size, pad_ratio, path):
    img, d, S = base(size, pad_ratio)
    draw_box(d, S, 1.0)
    for sx, sy, r in [(0.30, 0.28, 0.012), (0.74, 0.24, 0.009), (0.80, 0.40, 0.007), (0.24, 0.42, 0.007)]:
        sparkle(d, S * sx, S * sy, S * r)
    img.save(path)

make(512, 0.06, '/home/user/pvz-game/icons/icon-512.png')
make(192, 0.06, '/home/user/pvz-game/icons/icon-192.png')
make(180, 0.06, '/home/user/pvz-game/icons/apple-touch-icon.png')
make(512, 0.18, '/home/user/pvz-game/icons/icon-maskable-512.png')  # maskable с запасом
make(192, 0.18, '/home/user/pvz-game/icons/icon-maskable-192.png')
print('icons done')
