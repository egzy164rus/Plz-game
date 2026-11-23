from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3500)
    # берём короб, ТТН, распаковка
    bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
    page.evaluate(f"() => window.PVZ.player.position.set({bx+0.9}, 0, {bz})")
    page.keyboard.press("KeyE"); page.wait_for_timeout(200)
    page.evaluate("() => window.PVZ.player.position.set(-4.4, 0, -0.9)")
    page.keyboard.press("KeyE")
    page.wait_for_function("window.PVZ.G.carried && window.PVZ.G.carried.docScanned === true", timeout=6000)
    page.keyboard.press("KeyE")
    page.wait_for_function("window.PVZ.parcels.length >= 3", timeout=6000)
    ids = page.evaluate("window.PVZ.parcels.map(p => p.id)")
    floor = page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='parcel').map(i => i.id)")
    print("parcels:", ids)
    print("floor:  ", floor)
    print("unique:", len(ids) == len(set(ids)))
    browser.close()
