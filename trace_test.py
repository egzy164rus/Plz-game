from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: print("PAGEERR:", e))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3500)

    bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
    page.evaluate(f"() => window.PVZ.player.position.set({bx+0.9}, 0, {bz})")
    page.keyboard.press("KeyE"); page.wait_for_timeout(250)
    page.evaluate("() => window.PVZ.player.position.set(-4.4, 0, -0.9)")
    page.keyboard.press("KeyE")
    page.wait_for_function("window.PVZ.G.carried && window.PVZ.G.carried.docScanned === true", timeout=6000)
    page.keyboard.press("KeyE")
    page.wait_for_function("window.PVZ.parcels.length >= 3", timeout=6000)
    print("floor after unpack:", page.evaluate("window.PVZ.floorItems.map(i=>i.kind+':'+i.id)"))

    for it_idx in range(2):
        print(f"--- iteration {it_idx+1}")
        print("find first parcel:", page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='parcel'); return it && it.id; }"))
        page.evaluate("""() => {
            const it = window.PVZ.floorItems.find(i=>i.kind==='parcel');
            if (it) window.PVZ.player.position.set(it.mesh.position.x + 0.8, 0, it.mesh.position.z);
        }""")
        page.wait_for_timeout(150)
        print("interaction:", page.evaluate("window.PVZ.getInteraction() && window.PVZ.getInteraction().label"))
        page.keyboard.press("KeyE"); page.wait_for_timeout(200)
        print("carried after pickup:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.id"))
        cell = page.evaluate("""() => {
            for (const s of window.PVZ.shelves) for (const c of s.cells) if (!c.parcel) return [c.x, c.z];
            return null;
        }""")
        page.evaluate(f"() => window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9)")
        page.wait_for_timeout(150)
        print("interaction at cell:", page.evaluate("window.PVZ.getInteraction() && window.PVZ.getInteraction().label"))
        page.keyboard.press("KeyE"); page.wait_for_timeout(200)
        print("carried after store:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.id"))
        print("stored so far:", page.evaluate("window.PVZ.parcels.filter(p=>p.cell).length"))
    browser.close()
