import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(600)
    print("layout before:", page.evaluate("window.PVZ.G.layout"), "| counter x:", page.evaluate("window.PVZ.COUNTER_POS.x"))

    # открыть помещения и выбрать «Витрина» для метро
    page.click("#btn-loc")
    page.wait_for_timeout(250)
    print("chips:", page.evaluate("[...document.querySelectorAll('.layout-chip')].map(b=>b.dataset.plan+':'+b.textContent)"))
    page.evaluate("""() => {
        const chip = [...document.querySelectorAll('.layout-chip')].find(b => b.dataset.plan === '1');
        chip.click();
    }""")
    page.wait_for_timeout(400)
    print("layout now:", page.evaluate("window.PVZ.G.layout"), "| counter x:", page.evaluate("window.PVZ.COUNTER_POS.x"),
          "| table x:", page.evaluate("window.PVZ.TABLE_POS.x"), "| pallet x:", page.evaluate("window.PVZ.PALLET_POS.x"))
    print("queue slot0 x:", page.evaluate("window.PVZ.QUEUE_SLOTS[0].x"))
    print("layoutsByLoc:", page.evaluate("JSON.stringify(window.PVZ.G.layoutsByLoc)"))
    page.click("#btn-loc-close")

    # перезагрузка: выбор должен пережить рестарт (localStorage)
    page.reload(wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(600)
    print("after reload — layout:", page.evaluate("window.PVZ.G.layout"), "| counter x:", page.evaluate("window.PVZ.COUNTER_POS.x"))

    # вернуть «Классика»
    page.click("#btn-loc")
    page.wait_for_timeout(250)
    page.evaluate("""() => {
        const chip = [...document.querySelectorAll('.layout-chip')].find(b => b.dataset.plan === '0');
        chip.click();
    }""")
    page.wait_for_timeout(400)
    print("restored layout:", page.evaluate("window.PVZ.G.layout"), "| counter x:", page.evaluate("window.PVZ.COUNTER_POS.x"))
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
