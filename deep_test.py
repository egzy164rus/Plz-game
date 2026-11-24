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
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    # ждём первую поставку (3-я секунда)
    page.wait_for_timeout(3500)
    n_big = page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').length")
    print("big boxes on floor after 4s:", n_big)
    bigpos = page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').map(i=>[i.mesh.position.x.toFixed(2), i.mesh.position.z.toFixed(2)])")
    print("box positions:", bigpos)

    if n_big >= 1:
        # телепортируемся к коробу и поднимаем его
        bx, bz = page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); return [it.mesh.position.x, it.mesh.position.z]; }")
        page.evaluate(f"() => {{ window.PVZ.player.position.set({bx+0.9}, 0, {bz}); }}")
        page.wait_for_timeout(300)
        page.keyboard.press("KeyE")
        page.wait_for_timeout(300)
        carried = page.evaluate("window.PVZ.G.carried ? window.PVZ.G.carried.kind : null")
        print("carried after E at box:", carried)

        # к столу: ТТН, потом распаковка
        page.evaluate("() => { window.PVZ.player.position.set(-3.6, 0, -0.9); }")
        page.wait_for_timeout(300)
        page.keyboard.press("KeyE")  # сканировать ТТН
        page.wait_for_timeout(1200)
        ttn = page.evaluate("window.PVZ.G.carried ? window.PVZ.G.carried.docScanned : null")
        print("TTN scanned:", ttn)
        page.keyboard.press("KeyE")  # распаковать
        page.wait_for_timeout(2600)
        n_par = page.evaluate("window.PVZ.parcels.length")
        print("parcels after unpack:", n_par)

        # разложить первые две посылки по ячейкам
        for _ in range(2):
            # взять ближайшую посылку на столе
            taken = page.evaluate("""() => {
                const it = window.PVZ.floorItems.find(i=>i.kind==='parcel');
                if (!it) return null;
                window.PVZ.player.position.set(it.mesh.position.x + 0.8, 0, it.mesh.position.z);
                return it.id;
            }""")
            print("taking parcel:", taken)
            page.wait_for_timeout(200)
            page.keyboard.press("KeyE")
            page.wait_for_timeout(200)
            # телепорт к первой свободной ячейке
            cell = page.evaluate("""() => {
                for (const s of window.PVZ.shelves) for (const c of s.cells) if (!c.parcel) return [c.x, c.z];
                return null;
            }""")
            page.evaluate(f"() => {{ window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9); }}")
            page.wait_for_timeout(200)
            page.keyboard.press("KeyE")
            page.wait_for_timeout(300)

        stored = page.evaluate("window.PVZ.parcels.filter(p=>p.cell).length")
        print("parcels stored in cells:", stored)

        # замораживаем естественный спавн, чтобы тест был детерминированным
        page.evaluate("window.PVZ.G.customerTimer = 9999")
        # принудительно вызвать клиента
        page.evaluate("window.PVZ.spawnCustomer()")
        page.wait_for_timeout(4500)  # он идёт к очереди
        cust = page.evaluate("window.PVZ.customers.length")
        state = page.evaluate("window.PVZ.customers.map(c=>c.state)")
        print("customers:", cust, state)
        wanted = page.evaluate("window.PVZ.customers.map(c=>c.parcel?c.parcel.id:null)")
        print("wanted:", wanted)

        # сначала QR всех ожидающих клиентов на стойке (механика QR-first, выдача без QR запрещена)
        for _ in range(3):
            unscanned = page.evaluate("window.PVZ.customers.filter(c => c.state === 'waiting' && !c.isReturn && !c.qrScanned).length")
            if unscanned == 0:
                break
            page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
            page.wait_for_timeout(250)
            page.keyboard.press("KeyE")
            page.wait_for_timeout(1300)
        print("qr scanned:", page.evaluate("window.PVZ.customers.map(c => c.qrScanned)"))

        # взять нужную посылку из ячейки
        cell = page.evaluate("""() => {
            for (const s of window.PVZ.shelves) for (const c of s.cells)
                if (c.parcel && c.parcel.reservedBy) return [c.x, c.z];
            return null;
        }""")
        print("cell with wanted parcel:", cell)
        if cell:
            page.evaluate(f"() => {{ window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9); }}")
            page.wait_for_timeout(250)
            print("interaction at cell:", page.evaluate("() => { const it = window.PVZ.getInteraction(); return it && it.label ? it.label : String(it); }"))
            page.keyboard.press("KeyE")
            page.wait_for_timeout(300)
            print("carried after cell E:", page.evaluate("window.PVZ.G.carried ? window.PVZ.G.carried.kind : null"))
            # к стойке
            page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
            page.wait_for_timeout(300)
            print("interaction at counter:", page.evaluate("() => { const it = window.PVZ.getInteraction(); return it && it.label ? it.label : String(it); }"))
            page.keyboard.press("KeyE")  # выдача (сканирование заказа)
            page.wait_for_timeout(2200)
            print("carried after counter E:", page.evaluate("window.PVZ.G.carried ? window.PVZ.G.carried.kind : null"))
            money = page.evaluate("window.PVZ.G.money")
            issued = page.evaluate("window.PVZ.G.issuedToday")
            print("money:", money, "issuedToday:", issued)

    money_final = page.evaluate("window.PVZ.G.money")
    issued_final = page.evaluate("window.PVZ.G.issuedToday")
    print("RESULT:", "PASS" if issued_final >= 1 else "FAIL", f"(money={money_final}, issued={issued_final})")
    page.screenshot(path="/home/user/pvz-game/shot_deep.png")
    browser.close()
    if issued_final < 1:
        import sys; sys.exit(1)

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
