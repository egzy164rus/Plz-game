from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1100, "height": 650})
    errors, missing = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: missing.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    page.goto("https://egzy164rus.github.io/Plz-game/", wait_until="networkidle", timeout=60000)
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    version = page.text_content("#app-version")
    sw = page.evaluate("() => navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then(r => r.length)")
    print("menu visible ✓ | app-version:", version.strip() if version else None)
    print("HTTP >=400:", missing or "none")
    print("page/console errors:", errors or "none")
    print("btn-start:", page.text_content("#btn-start").strip())
    browser.close()
