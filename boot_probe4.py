from playwright.sync_api import sync_playwright
import time
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: print("PAGEERROR:", getattr(e, 'stack', str(e))))
    t0 = time.time()
    page.goto("http://localhost:8090/", wait_until="networkidle")
    try:
        page.wait_for_selector("#menu:not(.hidden)", timeout=60000)
        print(f"menu visible after {time.time() - t0:.1f}s")
        print("btn-start visible:", page.is_visible("#btn-start"))
    except Exception as e:
        print("TIMEOUT waiting for menu:", e)
    browser.close()
