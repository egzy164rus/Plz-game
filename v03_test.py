import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.wait_for_timeout(300)
    print("loading hidden:", page.evaluate("document.getElementById('loading').classList.contains('done')"))

    page.fill("#pvz-name", "У Янтаря")
    page.click(".logo-opt[data-mark='🦊']")
    page.click("#btn-start")
    page.wait_for_timeout(400)
    print("brand on HUD:", page.evaluate("document.getElementById('hud-name').innerText.split('\\n')[0]"), page.evaluate("document.getElementById('hud-logo').innerText"))

    page.wait_for_timeout(3200)
    bigpos = page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').map(i=>[+i.mesh.position.x.toFixed(2), +i.mesh.position.z.toFixed(2)])")
    print("boxes:", bigpos)

    bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
    page.evaluate(f"() => window.PVZ.player.position.set({bx+0.9}, 0, {bz})")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(200)
    print("carried box:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.kind"))

    page.evaluate("() => window.PVZ.player.position.set(-3.6, 0, -0.9)")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(1300)
    print("ttn:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.docScanned"))
    page.keyboard.press("KeyE")
    page.wait_for_timeout(2800)
    print("parcels on table:", page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='parcel').length"))

    for _ in range(2):
        page.evaluate("""() => {
            const it = window.PVZ.floorItems.find(i=>i.kind==='parcel');
            if (it) window.PVZ.player.position.set(it.mesh.position.x + 0.8, 0, it.mesh.position.z);
        }""")
        page.wait_for_timeout(150)
        page.keyboard.press("KeyE")
        page.wait_for_timeout(150)
        cell = page.evaluate("""() => {
            for (const s of window.PVZ.shelves) for (const c of s.cells) if (!c.parcel) return [c.x, c.z];
            return null;
        }""")
        page.evaluate(f"() => window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9)")
        page.wait_for_timeout(150)
        page.keyboard.press("KeyE")
        page.wait_for_timeout(200)
    print("stored in cells:", page.evaluate("window.PVZ.parcels.filter(p=>p.cell).length"))

    page.evaluate("window.PVZ.spawnCustomer()")
    page.wait_for_timeout(4200)
    cust = page.evaluate("window.PVZ.customers.map(c=>({state:c.state, qr:c.qrScanned, id:c.parcel?c.parcel.id:null}))")
    print("customer:", cust)

    page.evaluate("() => window.PVZ.player.position.set(4.0, 0, 3.4)")
    page.wait_for_timeout(250)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(200)
    print("action at counter:", page.evaluate("window.PVZ.G.action && window.PVZ.G.action.type"))
    page.wait_for_timeout(1300)
    print("qrScanned:", page.evaluate("window.PVZ.customers[0] && window.PVZ.customers[0].qrScanned"))
    print("order card visible:", page.evaluate("!document.getElementById('order-card').classList.contains('hidden')"))
    print("order card cell:", page.evaluate("document.getElementById('oc-cell').innerText"))
    page.screenshot(path="/home/user/pvz-game/shot_v03_qr.png")

    cell = page.evaluate("""() => {
        for (const s of window.PVZ.shelves) for (const c of s.cells)
            if (c.parcel && c.parcel.reservedBy) return [c.x, c.z];
        return null;
    }""")
    print("reserved cell:", cell)
    page.evaluate(f"() => window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9)")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(200)
    print("carried wanted:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.id"))

    page.evaluate("() => window.PVZ.player.position.set(4.0, 0, 3.4)")
    page.wait_for_timeout(250)
    before = page.evaluate("window.PVZ.G.money")
    page.keyboard.press("KeyE")
    page.wait_for_timeout(2300)
    after = page.evaluate("window.PVZ.G.money")
    print("money:", before, "->", after, "| issued:", page.evaluate("window.PVZ.G.issuedToday"),
          "| order card hidden:", page.evaluate("document.getElementById('order-card').classList.contains('hidden')"))
    page.screenshot(path="/home/user/pvz-game/shot_v03_game.png")

    # --- магазин и размещение ---
    page.evaluate("window.PVZ.G.money = 99999")
    page.click("#btn-shop")
    page.wait_for_timeout(300)
    print("shop sections:", page.evaluate("[...document.querySelectorAll('.shop-section')].map(e=>e.textContent)"))
    page.screenshot(path="/home/user/pvz-game/shot_v03_shop.png")
    page.evaluate("""() => {
        const items = [...document.querySelectorAll('.shop-item')];
        const sofa = items.find(i => i.innerText.includes('Диван'));
        sofa.querySelector('.si-buy').click();
    }""")
    page.wait_for_timeout(300)
    print("placement mode:", page.evaluate("window.PVZ.G.placing && window.PVZ.G.placing.id"))

    # найти экранную точку для свободного места в зале
    proj = page.evaluate("""() => {
        const cam = window.PVZ.camera;
        const out = [];
        for (const [wx, wz] of [[0,0.5],[-2,1],[2,0.5],[-2,-1.5],[1.5,-1],[0,-2.5],[-4.5,1.5],[0.5,3]]) {
            const v = new window.THREE.Vector3(wx, 0, wz).project(cam);
            out.push([wx, wz, (v.x*0.5+0.5)*window.innerWidth, (-v.y*0.5+0.5)*window.innerHeight]);
        }
        return out;
    }""")
    placed_at = None
    for wx, wz, sx, sy in proj:
        page.mouse.move(sx, sy)
        page.wait_for_timeout(250)
        v = page.evaluate("window.PVZ.G.placing && window.PVZ.G.placing.valid")
        print(f"world({wx},{wz}) -> screen({sx:.0f},{sy:.0f}) valid={v}")
        if v:
            placed_at = (sx, sy)
            break
    if placed_at:
        page.mouse.click(placed_at[0], placed_at[1])
        page.wait_for_timeout(300)
    print("placed, inventory:", page.evaluate("window.PVZ.G.inventory.length"), "| placing:", page.evaluate("window.PVZ.G.placing"))
    page.screenshot(path="/home/user/pvz-game/shot_v03_placed.png")

    # --- помещения ---
    page.click("#btn-loc")
    page.wait_for_timeout(300)
    print("location cards:", page.evaluate("document.querySelectorAll('.loc-card').length"))
    page.screenshot(path="/home/user/pvz-game/shot_v03_loc.png")
    owned = page.evaluate("""() => {
        const cards = [...document.querySelectorAll('.loc-card')];
        const sleep = cards.find(c => c.innerText.toLowerCase().includes('спальник'));
        sleep.querySelector('.loc-btn').click();
        return window.PVZ.G.ownedLocations.slice();
    }""")
    page.wait_for_timeout(200)
    print("ownedLocations:", owned, "| current:", page.evaluate("window.PVZ.G.location"))
    page.click("#btn-loc-close")
    print("locations closed, screen:", page.evaluate("window.PVZ.G.screen"))

    page.screenshot(path="/home/user/pvz-game/shot_v03_final.png")
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
