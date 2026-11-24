from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: print("PAGEERROR stack:\n", getattr(e, 'stack', '') or str(e)))
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_timeout(2500)
    browser.close()
