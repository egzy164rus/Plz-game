import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2000)
    page.evaluate("window.PVZ.G.timeLeft = 0.5")
    page.wait_for_timeout(1500)
    st = page.evaluate("""() => ({
      screen: window.PVZ.G.screen,
      dayEndVisible: !document.getElementById('day-end').classList.contains('hidden'),
      autosave: document.getElementById('de-autosave').textContent,
      deDay: document.getElementById('de-day').textContent,
      saveInLS: !!localStorage.getItem('pvz_save_v1_1'),
      day: JSON.parse(localStorage.getItem('pvz_save_v1_1') || '{}').day,
    })""")
    print(st)
    ok = (st['screen'] == 'dayEnd' and st['dayEndVisible'] and 'слот 1' in st['autosave']
          and st['saveInLS'] and st['day'] == 1 and not errors)
    browser.close()

print("ENDDAY TEST:", "PASS" if ok else "FAIL")
for e in errors:
    print(" -", e)
sys.exit(0 if ok else 1)
