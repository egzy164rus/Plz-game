import sys
from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.goto("https://egzy164rus.github.io/Plz-game/", wait_until="networkidle", timeout=60000)
    page.wait_for_selector("#btn-start", state="visible", timeout=60000)
    sw_ok = page.evaluate("navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then(r => r.length > 0)")
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=20000)
    print("SW registered:", sw_ok, "| controller:", page.evaluate("!!navigator.serviceWorker.controller"))
    page.click("#btn-start")
    page.wait_for_timeout(1500)
    print("game started, screen:", page.evaluate("window.PVZ.G.screen"), "| brand:", page.evaluate("document.getElementById('hud-name').innerText.split('\\n')[0]"))
    page.screenshot(path="/home/user/pvz-game/shot_live.png")
    browser.close()
print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
