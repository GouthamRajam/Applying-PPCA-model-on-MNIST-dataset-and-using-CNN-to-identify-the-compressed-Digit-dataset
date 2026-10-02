"""Draws the Senson logo (a wafer heat map with sensor dots on the app's header gradient) as SVG,
and renders the PNG sizes Windows needs for the .exe icon. Run: python3 make_logo.py"""
import math, os, sys

def svg(size_hint=256):
    small = size_hint <= 32
    dots = []
    if not small:
        rings = [(0, 1), (30, 6), (56, 12)] if size_hint >= 64 else [(0, 1), (40, 6)]
        rdot = 5.2 if size_hint >= 64 else 8
        for r, n in rings:
            for k in range(n):
                a = 2 * math.pi * k / n + (math.pi / n if n == 12 else 0) - math.pi / 2
                dots.append(f'<circle cx="{128 + r*math.cos(a):.1f}" cy="{124 + r*math.sin(a):.1f}" r="{rdot}" fill="#fff" fill-opacity=".92"/>')
    rim = 12 if small else 7
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
  <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="8" y1="8" x2="248" y2="248">
    <stop offset="0" stop-color="#0e7490"/><stop offset=".55" stop-color="#6d28d9"/><stop offset="1" stop-color="#be185d"/>
  </linearGradient>
  <radialGradient id="heat" cx=".46" cy=".42" r=".62">
    <stop offset="0" stop-color="#fde047"/><stop offset=".3" stop-color="#fb923c"/>
    <stop offset=".58" stop-color="#ef4444"/><stop offset=".8" stop-color="#a855f7"/><stop offset="1" stop-color="#22c3e6"/>
  </radialGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>
<g>
  <circle cx="128" cy="124" r="{92 if small else 90}" fill="#fff"/>
  <circle cx="128" cy="124" r="{92-rim if small else 90-rim}" fill="url(#heat)"/>
  {''.join(dots)}
  <circle cx="128" cy="{216 if small else 214}" r="{14 if small else 10}" fill="url(#bg)"/>
</g>
</svg>'''

if __name__ == "__main__":
    from playwright.sync_api import sync_playwright
    out = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(out, "senson-logo.svg"), "w").write(svg(256))
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None)
        for s in (16, 24, 32, 48, 64, 128, 256):
            pg = b.new_page(viewport={"width": s, "height": s})
            pg.set_content(f'<body style="margin:0;background:transparent">{svg(s).replace(chr(10), "")}</body>'.replace('width="256" height="256"', f'width="{s}" height="{s}"'))
            pg.screenshot(path=os.path.join(out, f"icon-{s}.png"), omit_background=True)
        b.close()
    print("ok")
