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
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    # дождаться активации SW
    page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=15000)
    print("sw controller active:", page.evaluate("!!navigator.serviceWorker.controller"))
    regs = page.evaluate("navigator.serviceWorker.getRegistrations().then(r => r.length)")
    print("registrations:", regs)
    manifest = page.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    print("manifest name:", manifest["name"], "| icons:", len(manifest["icons"]))

    # второй заход — офлайн: страница должна подняться из кэша
    page.reload(wait_until="networkidle")
    ctx.set_offline(True)
    page2 = ctx.new_page()
    page2.on("pageerror", lambda e: errors.append(f"pageerror(offline): {e}"))
    page2.goto(URL, wait_until="domcontentloaded")
    page2.wait_for_timeout(2500)
    ok = page2.evaluate("!!document.getElementById('loading') && !!document.getElementById('game-canvas')")
    brand = page2.evaluate("document.title")
    print("offline reload DOM up:", ok, "| title:", brand)
    ctx.set_offline(False)
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
