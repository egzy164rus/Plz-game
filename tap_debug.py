from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 420, "height": 760}, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.tap("#btn-start")
    page.wait_for_timeout(3500)

    box = page.evaluate("""() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); if(!it) return null; window.PVZ.player.position.set(it.mesh.position.x + 0.9, 0, it.mesh.position.z); return [it.mesh.position.x, it.mesh.position.z]; }""")
    print("box:", box, "player:", page.evaluate("[window.PVZ.player.position.x, window.PVZ.player.position.z]"))
    print("screen:", page.evaluate("window.PVZ.G.screen"))
    print("interaction:", page.evaluate("window.PVZ.getInteraction() && window.PVZ.getInteraction().label"))
    print("elementFromPoint(330,320):", page.evaluate("document.elementFromPoint(330, 320) && document.elementFromPoint(330, 320).id"))
    print("elementFromPoint tag:", page.evaluate("document.elementFromPoint(330, 320) && document.elementFromPoint(330, 320).tagName"))

    cdp = ctx.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 330, "y": 320, "id": 1}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(300)
    print("carried after tap:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.kind"))
    print("autoMove:", page.evaluate("window.PVZ.G.autoMove && window.PVZ.G.autoMove.dest"))
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
