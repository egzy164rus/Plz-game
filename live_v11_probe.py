from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    errors, missing = [], []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: missing.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    page.goto("https://egzy164rus.github.io/Plz-game/", wait_until="networkidle", timeout=60000)
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    version = page.text_content("#app-version")
    chips = page.evaluate("() => [...document.querySelectorAll('.chips .chip')].map(e => e.textContent.trim())")
    print("menu visible ✓ | app-version:", (version or '').strip())
    print("chips has v0.11:", any('По два заказа' in c for c in chips), any('Картон за деньги' in c for c in chips))
    # Быстрый заход в игру
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    print("screen:", page.evaluate("window.PVZ.G.screen"))
    print("cardboard in BALANCE:", page.evaluate("() => typeof BALANCE !== 'undefined' ? BALANCE.cardboardPrice : (window.PVZ.G && 'n/a')"))
    print("HTTP >=400:", missing or "none")
    print("page/console errors:", errors or "none")
    browser.close()
