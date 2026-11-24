from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.screenshot(path="/home/user/pvz-game/shot_v11_menu.png")
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    page.evaluate("window.PVZ.G.customerTimer = 9999")
    for _ in range(20):
        if page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').length") >= 1: break
        page.wait_for_timeout(500)
    bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
    page.evaluate(f"() => {{ window.PVZ.player.position.set({bx+0.9}, 0, {bz}); }}")
    page.wait_for_timeout(400)
    page.keyboard.press("KeyE"); page.wait_for_timeout(300)
    page.evaluate("window.PVZ.player.position.set(-3.6, 0, -0.9)"); page.wait_for_timeout(300)
    page.keyboard.press("KeyE"); page.wait_for_timeout(1300)
    page.keyboard.press("KeyE"); page.wait_for_timeout(2700)
    # вторая коробка → стопка из двух плоских коробов
    for _ in range(20):
        if page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').length") >= 1: break
        page.wait_for_timeout(500)
    nbig = page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').length")
    print("big boxes left:", nbig)
    if nbig:
        bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
        page.evaluate(f"() => {{ window.PVZ.player.position.set({bx+0.9}, 0, {bz}); }}")
        page.wait_for_timeout(400)
        page.keyboard.press("KeyE"); page.wait_for_timeout(300)
        page.evaluate("window.PVZ.player.position.set(-3.6, 0, -0.9)"); page.wait_for_timeout(300)
        page.keyboard.press("KeyE"); page.wait_for_timeout(1300)
        page.keyboard.press("KeyE"); page.wait_for_timeout(2700)
    print("cardboard:", page.evaluate("window.PVZ.G.cardboard"))
    # встать к стопке
    page.evaluate("() => { window.PVZ.player.position.set(-2.78, 0, 0.9); window.PVZ.player.rotation.y = Math.PI; }")
    page.wait_for_timeout(600)
    page.screenshot(path="/home/user/pvz-game/shot_v11_game.png")
    browser.close()
