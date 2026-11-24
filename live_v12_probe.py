import sys, time
from playwright.sync_api import sync_playwright
URL = "https://egzy164rus.github.io/Plz-game/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page()
    page.on("pageerror", lambda e: print("pageerror:", e))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    ver = page.evaluate("document.getElementById('app-version').textContent")
    sw = page.evaluate("""async () => { const reg = await navigator.serviceWorker.getRegistration(); return reg && reg.active ? reg.active.scriptURL : 'none'; }""")
    print("version:", ver, "| sw:", sw)
    page.click("#btn-start")
    page.wait_for_timeout(2000)
    cells = page.evaluate("window.PVZ.shelves.flatMap(s => s.cells).length")
    mvBtn = page.evaluate("!!document.getElementById('btn-move') && (document.getElementById('btn-move').getAttribute('title')||'').includes('Перестановка')")
    hasMove = page.evaluate("typeof window.PVZ.debugToggleMove === 'function'")
    print("cells:", cells, "| move button:", mvBtn, "| move hooks:", hasMove)
    browser.close()
    assert ver == 'v0.12' and cells == 16 and mvBtn and hasMove
    print("LIVE V12: PASS")
