from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: print("PAGEERROR:", getattr(e, 'stack', str(e))))
    page.on("console", lambda m: print(f"[console.{m.type}]", m.text[:200]) if m.type in ("error", "warning") else None)
    page.goto("http://localhost:8090/", wait_until="networkidle")
    for wait in (1, 2, 3, 5):
        page.wait_for_timeout(1000 if wait == 1 else (1000 if wait == 2 else (1000 if wait == 3 else 2000)))
        st = page.evaluate("""() => ({
          loading: document.getElementById('loading') && document.getElementById('loading').className,
          menuHidden: document.getElementById('menu') ? document.getElementById('menu').className : 'NO-EL',
          bootFill: document.getElementById('boot-fill') ? document.getElementById('boot-fill').style.width : null,
          bootStatus: document.getElementById('boot-status') ? document.getElementById('boot-status').textContent : null,
        })""")
        print(f"t+{wait}s", st)
    browser.close()
