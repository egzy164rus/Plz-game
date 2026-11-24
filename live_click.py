from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1100, "height": 650})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto("https://egzy164rus.github.io/Plz-game/", wait_until="networkidle", timeout=60000)
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(3000)
    st = page.evaluate("() => ({ screen: window.PVZ && window.PVZ.G.screen, day: window.PVZ && window.PVZ.G.day, sw: !!navigator.serviceWorker })")
    print("after start:", st)
    page.wait_for_timeout(2500)
    print("parcels:", page.evaluate("window.PVZ.parcels.length"), "| customers:", page.evaluate("window.PVZ.customers.length"))
    print("errors:", errors or "none")
    browser.close()
