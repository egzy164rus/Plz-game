from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 420, "height": 760}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page()
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.tap("#btn-start")
    page.wait_for_timeout(1000)
    print("innerWidth:", page.evaluate("window.innerWidth"), "dpr:", page.evaluate("window.devicePixelRatio"))
    print("elem(330,320):", page.evaluate("document.elementFromPoint(330, 320) && document.elementFromPoint(330, 320).id"))
    cdp = ctx.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 380, "y": 320, "id": 1}]})
    print("joystick after touchStart(380):", page.evaluate("document.getElementById('joystick').classList.contains('show')"))
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    browser.close()
