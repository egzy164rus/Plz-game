import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    page.evaluate("window.PVZ.G.customerTimer = 9999")

    # --- 1) 8 ячеек на стеллаж, посылка меньше прежней (0.5×0.34×0.4)
    cells = page.evaluate("window.PVZ.shelves.flatMap(s => s.cells).length")
    bbox = page.evaluate("""() => { const id = window.PVZ.debugSpawnParcel('normal', -4.4, -0.9); const par = window.PVZ.parcels.find(q => q.id === id); par.mesh.rotation.set(0, 0, 0); par.mesh.children[0].rotation.set(0, 0, 0); const b = new window.THREE.Box3().setFromObject(par.mesh.children[0]); return { w: +(b.max.x-b.min.x).toFixed(2), h: +(b.max.y-b.min.y).toFixed(2) }; }""")
    print("cells:", cells, "| parcel body bbox:", bbox)
    assert cells == 8 and bbox['w'] < 0.42 and bbox['h'] < 0.3, (cells, bbox)

    # --- 2) экспресс: единственный в ячейке ⇒ клиент просит именно его, терпение ×0.65
    page.evaluate("window.PVZ.debugClearParcels()")
    page.evaluate("""() => { for (const c of [...window.PVZ.customers]) { window.PVZ.scene.remove(c.mesh); } window.PVZ.customers.length = 0; }""")
    page.evaluate("window.PVZ.debugStockParcel('express')")
    page.evaluate("window.PVZ.G.customerTimer = 9999")
    r = page.evaluate("window.PVZ.spawnCustomer()")
    cust = page.evaluate("""() => window.PVZ.customers.map(c => ({ type: c.parcel && c.parcel.type, isVip: c.isVip, pMax: +c.patienceMax.toFixed(2), bubble: c.bubbleTitle && c.bubbleTitle.textContent }))""")
    print("express customer:", cust)
    assert cust and cust[0]['type'] == 'express'
    assert abs(cust[0]['pMax'] - 55 * 0.65) < 0.5, cust          # экспресс терпит на 35% меньше
    exp_id = page.evaluate("window.PVZ.customers[0].parcel.id")

    # убрать клиента (уронить терпение → уйдёт) и вернуть посылку
    page.evaluate("""() => { for (const c of [...window.PVZ.customers]) { window.PVZ.scene.remove(c.mesh); if (c.bubble) c.bubble.remove(); } window.PVZ.customers.length = 0; }""")

    # --- 3) VIP: vipChance через Math.random=0.01 → клиент VIP, терпение ×0.6
    page.evaluate("""() => { const orig = Math.random; Math.random = () => 0.01; try { window.PVZ.debugStockParcel('normal'); window.PVZ.spawnCustomer(); } finally { Math.random = orig; } }""")
    vip = page.evaluate("""() => window.PVZ.customers.map(c => ({ isVip: c.isVip, pMax: +c.patienceMax.toFixed(2), bubble: c.bubbleTitle && c.bubbleTitle.textContent }))""")
    print("vip customer:", vip)
    assert vip and vip[0]['isVip'] is True
    assert abs(vip[0]['pMax'] - 55 * 0.6) < 0.5, vip
    assert '👑' in (vip[0]['bubble'] or ''), vip

    # --- 4) полный цикл: чаевые за скорость + комбо; VIP-клиент даёт ×2.2
    page.evaluate("window.PVZ.debugClearParcels()")
    page.evaluate("""() => { for (const c of [...window.PVZ.customers]) { window.PVZ.scene.remove(c.mesh); if (c.bubble) c.bubble.remove(); } window.PVZ.customers.length = 0; }""")
    page.evaluate("window.PVZ.debugStockParcel('normal')")
    page.evaluate("window.PVZ.G.customerTimer = 9999")
    page.evaluate("""() => { const orig = Math.random; Math.random = () => 0.01; try { window.PVZ.spawnCustomer(); } finally { Math.random = orig; } }""")
    page.evaluate("window.PVZ.customers.forEach(c => { c.patience = 9999; c.patienceMax = 9999; })")
    page.wait_for_timeout(5200)   # идёт к стойке
    waiting = page.evaluate("window.PVZ.customers.map(c => c.state)")
    print("state:", waiting)
    # QR
    page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
    page.wait_for_timeout(250)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(1500)
    print("qr:", page.evaluate("window.PVZ.customers.map(c => c.qrScanned)"))
    # забрать посылку из ячейки (какую просит клиент)
    cell = page.evaluate("""() => { const c = window.PVZ.customers[0]; return c && c.parcel.cell ? [c.parcel.cell.x, c.parcel.cell.z] : null; }""")
    print("wanted cell:", cell)
    page.evaluate(f"() => {{ window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9); }}")
    page.wait_for_timeout(250)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(300)
    # к стойке; «сделали вид, что QR отсканировали 8 секунд назад» — быстрая выдача
    page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
    page.evaluate("window.PVZ.G.activeOrder.qrAt = performance.now() - 8000")
    money0 = page.evaluate("window.PVZ.G.money")
    page.wait_for_timeout(250)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(2200)
    after = page.evaluate("""() => ({ money: window.PVZ.G.money, tips: window.PVZ.G.tipsToday, combo: window.PVZ.G.tipCombo, issued: window.PVZ.G.issuedToday })""")
    print("before:", money0, "-> after:", after)
    assert after['issued'] == 1
    assert after['tips'] == 25, after          # комбо ×1 = 25 ₽
    assert after['combo'] == 1
    delta = after['money'] - money0
    print("delta money:", delta, "(VIP payout 308..572 + tip 25)")
    assert delta >= 333, delta                  # VIP (140..260) ×2.2 + чаевые 25

    # --- 5) комбо-чип: ×2 прячется не должен
    page.evaluate("window.PVZ.G.tipCombo = 3")
    page.evaluate("window.updateComboChip()")
    chip = page.evaluate("() => ({ text: document.getElementById('combo-chip').textContent, hidden: document.getElementById('combo-chip').classList.contains('hidden') })")
    print("chip at combo 3:", chip)
    assert chip['hidden'] is False and '×3' in chip['text']
    page.evaluate("window.PVZ.G.tipCombo = 0")
    page.evaluate("window.updateComboChip()")
    chip2 = page.evaluate("document.getElementById('combo-chip').classList.contains('hidden')")
    print("chip at combo 0 hidden:", chip2)
    assert chip2 is True

    # --- 6) экран итогов содержит строку чаевых
    de_tips = page.evaluate("!!document.getElementById('de-tips')")
    print("de-tips element:", de_tips)
    assert de_tips

    browser.close()

print("ERRORS:", errors if errors else "none")
print("MECHANIC TEST:", "PASS" if not errors else "FAIL")
sys.exit(1 if errors else 0)
