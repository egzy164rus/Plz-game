from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    msgs = []
    page.on("console", lambda m: msgs.append(f"[{m.type}] {m.text}"))
    page.on("pageerror", lambda e: msgs.append(f"[PAGEERROR] {e}"))
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_timeout(3500)
    for m in msgs:
        print(m)
    st = page.evaluate("""() => ({
      loading: document.getElementById('loading') && document.getElementById('loading').className,
      menu: document.getElementById('menu') && document.getElementById('menu').className,
      bootFill: document.getElementById('boot-fill') ? document.getElementById('boot-fill').style.width : null,
    })""")
    print(st)
    browser.close()
