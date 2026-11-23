from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3600)

    # 1) короб в руках (не на голове)
    bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
    page.evaluate(f"() => window.PVZ.player.position.set({bx+0.9}, 0, {bz})")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(300)
    page.evaluate("() => { window.PVZ.player.rotation.y = 0.6; }")
    page.screenshot(path="/home/user/pvz-game/shot_v04_carry.png")

    # 2) анимация вскрытия коробки (крышки открываются)
    page.evaluate("() => window.PVZ.player.position.set(-4.4, 0, -0.9)")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")
    page.wait_for_function("window.PVZ.G.carried && window.PVZ.G.carried.docScanned === true", timeout=6000)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(500)
    page.screenshot(path="/home/user/pvz-game/shot_v04_unpack_anim.png")
    page.wait_for_function("window.PVZ.parcels.length >= 3", timeout=6000)
    page.wait_for_timeout(1600)
    page.screenshot(path="/home/user/pvz-game/shot_v04_parcels_row.png")

    # 3) модалка помещений с выбором планировки
    page.click("#btn-loc")
    page.wait_for_timeout(300)
    page.evaluate("""() => {
        const chip = [...document.querySelectorAll('.layout-chip')].find(b => b.dataset.plan === '2');
        chip.click();
    }""")
    page.wait_for_timeout(400)
    page.screenshot(path="/home/user/pvz-game/shot_v04_layouts.png")
    page.click("#btn-loc-close")
    page.wait_for_timeout(1200)
    page.screenshot(path="/home/user/pvz-game/shot_v04_open_space.png")
    browser.close()
print("done")
