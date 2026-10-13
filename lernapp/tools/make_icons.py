# Erzeugt die PWA-Icons (einfaches Karteikarten-Symbol).
from PIL import Image, ImageDraw
def make(size, maskable, path):
    bg = (18, 22, 28); accent = (108, 197, 176); card = (230, 235, 241)
    img = Image.new("RGBA", (size, size), bg if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=bg)
    s = size * (0.58 if maskable else 0.66)
    cx = cy = size / 2
    w, h = s * 0.78, s * 0.56
    r = int(size * 0.05)
    # hintere Karte (Akzent), vordere Karte (hell)
    d.rounded_rectangle([cx - w/2 + size*0.05, cy - h/2 - size*0.07, cx + w/2 + size*0.05, cy + h/2 - size*0.07], radius=r, fill=accent)
    d.rounded_rectangle([cx - w/2 - size*0.03, cy - h/2 + size*0.05, cx + w/2 - size*0.03, cy + h/2 + size*0.05], radius=r, fill=card)
    # Linien auf der vorderen Karte
    lx0 = cx - w/2 - size*0.03 + w*0.12; lx1 = cx + w/2 - size*0.03 - w*0.12
    for i, f in enumerate((0.30, 0.50, 0.70)):
        y = cy - h/2 + size*0.05 + h*f
        d.rounded_rectangle([lx0, y - size*0.012, lx1 - (w*0.25 if i == 2 else 0), y + size*0.012], radius=size*0.01, fill=(120, 135, 150))
    img.save(path)
make(192, False, "icons/icon-192.png")
make(512, False, "icons/icon-512.png")
make(512, True, "icons/maskable-512.png")
