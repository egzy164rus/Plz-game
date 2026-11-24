import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    page.evaluate("window.PVZ.G.customerTimer = 9999")

    # --- корпоративный заказ: 2 посылки, терпение ×1.6 ---
    page.evaluate("window.PVZ.debugClearParcels()")
    page.evaluate("""() => { for (const c of [...window.PVZ.customers]) { window.PVZ.scene.remove(c.mesh); if (c.bubble) c.bubble.remove(); } window.PVZ.customers.length = 0; }""")
    page.evaluate("window.PVZ.debugStockParcel('normal')")
    page.evaluate("window.PVZ.debugStockParcel('normal')")
    page.evaluate("() => { BALANCE.vipChance = 0; }")   # глушим VIP, чтобы детерминированно получить юр. лицо
    page.evaluate("""() => { const o = Math.random; Math.random = () => 0.02; try { window.PVZ.spawnCustomer(); } finally { Math.random = o; } }""")
    corp = page.evaluate("""() => window.PVZ.customers.map(c => ({ isCorp: c.isCorp, isVip: c.isVip, n: c.parcels && c.parcels.length, pMax: +c.patienceMax.toFixed(2), bubble: c.bubbleTitle && c.bubbleTitle.textContent }))""")
    print("corp customer:", corp)
    assert corp and corp[0]['isCorp'] is True and corp[0]['n'] == 2
    assert abs(corp[0]['pMax'] - 55 * 1.6) < 0.5
    assert '🏢' in (corp[0]['bubble'] or '')
    page.evaluate("window.PVZ.customers.forEach(c => { c.patience = 9999; c.patienceMax = 9999; })")
    for _ in range(60):
        if page.evaluate("() => window.PVZ.customers.every(c => c.state === 'waiting')"): break
        page.wait_for_timeout(500)
    else:
        raise SystemExit('customers never reached waiting state')
    print("state:", page.evaluate("window.PVZ.customers.map(c => c.state)"))

    # QR на стойке — карточка показывает обе посылки
    page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
    page.wait_for_timeout(250)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(1500)
    oid = page.evaluate("document.getElementById('oc-id').textContent")
    ocell = page.evaluate("document.getElementById('oc-cell').textContent")
    print("oc-id:", oid, "| oc-cell:", ocell)
    assert '+' in oid and 'Юр. лица' in ocell
    assert page.evaluate("window.PVZ.G.activeOrder.wanted.length") == 2

    def take_and_issue(which):
        wanted = page.evaluate(f"() => window.PVZ.G.activeOrder.wanted[{which}].id")
        cell = page.evaluate(f"() => {{ const p = window.PVZ.G.activeOrder.wanted[{which}]; return p.cell ? [p.cell.x, p.cell.z] : null; }}")
        print("taking:", wanted, "from cell:", cell)
        page.evaluate(f"() => {{ window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9); }}")
        page.wait_for_timeout(250)
        page.keyboard.press("KeyE")
        page.wait_for_timeout(300)
        page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
        page.wait_for_timeout(250)
        page.keyboard.press("KeyE")
        page.wait_for_timeout(2200)

    money0 = page.evaluate("window.PVZ.G.money")
    take_and_issue(0)
    mid = page.evaluate("""() => ({ money: window.PVZ.G.money, issued: window.PVZ.G.issuedToday, order: !!window.PVZ.G.activeOrder, wanted: window.PVZ.G.activeOrder && window.PVZ.G.activeOrder.wanted.length, cardVisible: !document.getElementById('order-card').classList.contains('hidden') })""")
    print("after 1st issue:", mid)
    assert mid['issued'] == 1 and mid['order'] is True and mid['wanted'] == 1 and mid['cardVisible'] is True

    take_and_issue(0)   # оставшийся — это теперь wanted[0]
    done = page.evaluate("""() => ({ money: window.PVZ.G.money, issued: window.PVZ.G.issuedToday, order: !!window.PVZ.G.activeOrder, cardHidden: document.getElementById('order-card').classList.contains('hidden'), custState: window.PVZ.customers.map(c => c.state) })""")
    print("after 2nd issue:", done)
    assert done['issued'] == 2 and done['order'] is False and done['cardHidden'] is True
    assert all(s != 'waiting' for s in done['custState'])
    print("corp payout delta:", done['money'] - money0)

    # --- картон: вскрываем короб, сдаём картон ---
    for _ in range(30):
        if page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').length") >= 1: break
        page.wait_for_timeout(500)
    page.evaluate("""() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); if(it) window.PVZ.player.position.set(it.mesh.position.x + 0.9, 0, it.mesh.position.z); }""")
    page.wait_for_timeout(300)
    page.keyboard.press("KeyE"); page.wait_for_timeout(300)
    page.evaluate("window.PVZ.player.position.set(-3.6, 0, -0.9)"); page.wait_for_timeout(300)
    page.keyboard.press("KeyE"); page.wait_for_timeout(1300)   # ТТН
    page.keyboard.press("KeyE"); page.wait_for_timeout(2700)   # распаковка
    cardboard = page.evaluate("window.PVZ.G.cardboard")
    print("cardboard after unpack:", cardboard)
    assert cardboard >= 1
    page.evaluate("() => { window.PVZ.player.position.set(-2.78, 0, -0.48); }")   # к стопке картона
    page.wait_for_timeout(250)
    prompt = page.evaluate("() => { const it = window.PVZ.getInteraction(); return it && it.label; }")
    print("prompt at table:", prompt)
    assert prompt and 'картон' in prompt.lower()
    money_c = page.evaluate("window.PVZ.G.money")
    page.keyboard.press("KeyE")           # сдать картон
    page.wait_for_timeout(1300)
    after_c = page.evaluate("""() => ({ money: window.PVZ.G.money, cardboard: window.PVZ.G.cardboard })""")
    print("after cardboard:", after_c)
    assert after_c['cardboard'] == cardboard - 1 and after_c['money'] == money_c + 8

    browser.close()

print("ERRORS:", errors if errors else "none")
print("V11 TEST:", "PASS" if not errors else "FAIL")
sys.exit(1 if errors else 0)
