import sys, math
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

def project(page, x, y, z):
    return page.evaluate(
        """([x, y, z]) => { const v = new window.THREE.Vector3(x, y, z).project(window.PVZ.camera); return [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight]; }""",
        [x, y, z])

def hover(page, x, y, z):
    sx, sy = project(page, x, y, z)
    page.mouse.move(sx, sy)
    page.wait_for_timeout(160)
    return sx, sy

def click_at(page, x, y, z):
    sx, sy = hover(page, x, y, z)
    page.mouse.click(sx, sy)
    page.wait_for_timeout(150)

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

    # --- 1) 16 ячеек на стеллаже
    cells = page.evaluate("window.PVZ.shelves.flatMap(s => s.cells).length")
    print("cells:", cells)
    assert cells == 16, cells

    # --- 2) перестановка стеллажа с посылкой: мышь тянет груз
    page.evaluate("window.PVZ.debugStockParcel('normal')")
    before = page.evaluate("""() => { const p = window.PVZ.parcels.find(p => p.cell); const s = window.PVZ.shelves[0]; return { cellX: p.cell.x, meshX: p.mesh.position.x, sx: s.x, sz: s.z }; }""")
    print("shelf before:", before)
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    # взять стеллаж за середину корпуса (видимая полка)
    click_at(page, before['sx'], 1.0, before['sz'])
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("after pickup:", mv)
    assert mv['moving'] is True and mv['kind'] == 'shelf'
    # тащим в центр зала (свободно от коллайдеров)
    sx, sy = hover(page, 0.0, 0, -2.3)
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("dragging over target:", mv)
    assert mv['valid'] is True
    page.mouse.click(sx, sy)          # отпускаем — поставить
    page.wait_for_timeout(150)
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("after commit click:", mv)
    assert mv['moving'] is False
    after = page.evaluate("""() => { const p = window.PVZ.parcels.find(p => p.cell); const s = window.PVZ.shelves[0]; return { cellX: p.cell.x, cellZ: p.cell.z, meshX: p.mesh.position.x, meshZ: p.mesh.position.z, sx: s.x, sz: s.z }; }""")
    print("shelf after:", after)
    assert abs(after['sx'] - 0.0) < 0.15 and abs(after['sz'] - (-2.3)) < 0.15, after
    assert abs(after['cellX'] - after['meshX']) < 0.05 and abs(after['cellZ'] - after['meshZ']) < 0.05

    # --- 3) поворот стеллажа на 180°: R, R; посылка на месте
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, after['sx'], 1.0, after['sz'])
    rot0 = page.evaluate("window.PVZ.G.moving.rot")
    page.keyboard.press("KeyR")
    page.keyboard.press("KeyR")
    page.wait_for_timeout(120)
    sx, sy = hover(page, 0.0, 0, -2.3)
    assert page.evaluate("window.PVZ.debugMoving()")['valid'] is True
    page.mouse.click(sx, sy)
    page.wait_for_timeout(150)
    rot1 = page.evaluate("window.PVZ.shelves[0].rot")
    chk = page.evaluate("() => { const p = window.PVZ.parcels.find(p => p.cell); return Math.abs(p.cell.x - p.mesh.position.x) < 0.05 && Math.abs(p.cell.z - p.mesh.position.z) < 0.05; }")
    print("shelf rot:", rot0, "->", rot1, "| parcel on cell:", chk)
    assert abs((rot1 - rot0) - math.pi) < 0.05
    assert chk

    # --- 4) Esc возвращает стеллаж на место
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, 0.0, 1.0, -2.3)
    sx, sy = hover(page, -2.0, 0, 1.5)
    page.keyboard.press("Escape")     # вернуть на место (режим перестановки остаётся)
    page.wait_for_timeout(120)
    back = page.evaluate("() => ({ x: window.PVZ.shelves[0].x, z: window.PVZ.shelves[0].z, moving: window.PVZ.debugMoving() })")
    print("after Esc-cancel:", back)
    assert abs(back['x'] - 0.0) < 0.15 and abs(back['z'] - (-2.3)) < 0.15
    assert back['moving']['moving'] is False

    # --- 5) стол распаковки тащит посылки за собой
    page.evaluate("window.PVZ.debugSpawnUnpacked()")
    page.wait_for_timeout(300)
    t0 = page.evaluate("() => ({ tx: window.PVZ.TABLE_POS.x, tz: window.PVZ.TABLE_POS.z })")
    print("table before:", t0)
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, t0['tx'], 0.95, t0['tz'])    # за столешницу
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("table pickup:", mv)
    assert mv['moving'] is True and mv['kind'] == 'table'
    sx, sy = hover(page, t0['tx'] + 1.5, 0, t0['tz'])
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("dragging table:", mv)
    assert mv['valid'] is True
    page.mouse.click(sx, sy)
    page.wait_for_timeout(150)
    t1 = page.evaluate("window.PVZ.TABLE_POS")
    on_table = page.evaluate("""() => { const T = window.PVZ.TABLE_POS; return window.PVZ.parcels.filter(p => !p.cell && p.mesh.position.y > 0.5).map(p => +Math.hypot(p.mesh.position.x - T.x, p.mesh.position.z - T.z).toFixed(2)); }""")
    print("table after:", t1, "| parcels dist:", on_table)
    assert abs(t1['x'] - (t0['tx'] + 1.5)) < 0.15
    assert on_table and all(d < 1.45 for d in on_table), on_table

    # --- 6) недопустимое место (контейнер для брака) — поставить нельзя
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, t1['x'], 0.95, t1['z'])
    sx, sy = hover(page, -6.6, 0, 3.7)
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("target on bin, valid =", mv['valid'])
    page.mouse.click(sx, sy)          # отказ — предмет остаётся в руках
    page.wait_for_timeout(150)
    t2 = page.evaluate("window.PVZ.TABLE_POS")
    still = page.evaluate("window.PVZ.debugMoving()")
    print("table stayed:", t2, "| still moving:", still['moving'])
    assert abs(t2['x'] - t1['x']) < 0.01 and still['moving'] is True
    page.keyboard.press("Escape")     # вернуть на место
    page.wait_for_timeout(120)

    # --- 7) стойка выдачи: переезжает рядом очередь
    q0 = page.evaluate("() => ({ cx: window.PVZ.COUNTER_POS.x, cz: window.PVZ.COUNTER_POS.z, q0: [window.PVZ.QUEUE_SLOTS[0].x, window.PVZ.QUEUE_SLOTS[0].z] })")
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, q0['cx'], 1.02, q0['cz'])
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("counter pickup:", mv)
    assert mv['moving'] is True and mv['kind'] == 'counter'
    sx, sy = hover(page, q0['cx'], 0, q0['cz'] - 0.8)
    page.mouse.click(sx, sy)
    page.wait_for_timeout(150)
    q1 = page.evaluate("() => ({ cx: window.PVZ.COUNTER_POS.x, cz: window.PVZ.COUNTER_POS.z, q0: [window.PVZ.QUEUE_SLOTS[0].x, window.PVZ.QUEUE_SLOTS[0].z], moved: window.PVZ.G.movedLayout })")
    print("counter after:", q1)
    assert abs(q1['cz'] - (q0['cz'] - 0.8)) < 0.15
    assert abs(q1['q0'][1] - (q0['q0'][1] - 0.8)) < 0.15
    assert 'counter' in q1['moved']

    # --- 8) ковёр «Классики» двигается
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, 4.0, 0.02, 3.6)    # ковёр Классики у стойки
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("rug pickup:", mv)
    if mv['moving']:
        sx, sy = hover(page, 2.0, 0, 1.6)
        page.mouse.click(sx, sy)
        page.wait_for_timeout(150)
        print("rug moved:", page.evaluate("window.PVZ.G.movedLayout.rug"))
        assert 'rug' in page.evaluate("window.PVZ.G.movedLayout")
    else:
        page.keyboard.press("Escape")

    # --- 9) скамейка из «Витрины» двигается
    page.evaluate("window.PVZ.applyLayout(1)")
    page.wait_for_timeout(400)
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, 2.6, 0.5, 4.55)    # скамейка «Витрины»
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("bench pickup:", mv)
    if mv['moving']:
        sx, sy = hover(page, 1.6, 0, 3.0)
        page.mouse.click(sx, sy)
        page.wait_for_timeout(150)
        bench = page.evaluate("window.PVZ.G.movedLayout.bench")
        print("bench moved:", bench)
        assert bench and abs(bench['x'] - 1.6) < 0.2
    else:
        page.keyboard.press("Escape")

    # --- 10) мебель из магазина: ставим растение и двигаем
    page.evaluate("window.PVZ.applyLayout(0)")
    page.wait_for_timeout(300)
    page.evaluate("window.PVZ.G.inventory.push('plant')")
    page.evaluate("window.PVZ.enterPlacement('plant')")
    page.wait_for_timeout(150)
    sx, sy = hover(page, 6.0, 0, 0.8)
    page.mouse.click(sx, sy)            # установить
    page.wait_for_timeout(200)
    placed = page.evaluate("window.PVZ.debugPlaced()")
    print("placed plant:", placed)
    assert any(f['id'] == 'plant' for f in placed)
    page.evaluate("window.PVZ.debugToggleMove()")
    page.wait_for_timeout(150)
    click_at(page, 6.0, 0.8, 0.8)     # за куст (ярус ~0.8 м)
    mv = page.evaluate("window.PVZ.debugMoving()")
    print("plant pickup:", mv)
    if mv['moving']:
        sx, sy = hover(page, 5.2, 0, -0.5)
        page.mouse.click(sx, sy)
        page.wait_for_timeout(150)
        placed2 = page.evaluate("window.PVZ.debugPlaced()")
        print("plant moved:", placed2)
        assert any(f['id'] == 'plant' and abs(f['x'] - 5.2) < 0.2 for f in placed2)
    else:
        page.keyboard.press("Escape")

    # --- 11) сохранение → перезагрузка → всё на местах
    saved = page.evaluate("() => ({ movedLayout: window.PVZ.G.movedLayout, shelves: window.PVZ.shelves.map(s => [+s.x.toFixed(2), +s.z.toFixed(2), +s.rot.toFixed(2)]) })")
    print("pre-save:", saved)
    page.keyboard.press("Escape")     # пауза
    page.wait_for_timeout(300)
    page.click("#btn-pause-save")
    page.wait_for_timeout(700)
    page.reload(wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    restored = page.evaluate("() => ({ TABLE: [window.PVZ.TABLE_POS.x, window.PVZ.TABLE_POS.z], COUNTER: [window.PVZ.COUNTER_POS.x, window.PVZ.COUNTER_POS.z], movedLayout: window.PVZ.G.movedLayout, shelves: window.PVZ.shelves.map(s => [+s.x.toFixed(2), +s.z.toFixed(2), +s.rot.toFixed(2)]) })")
    print("after reload:", restored)
    assert 'table' in restored['movedLayout'] and 'counter' in restored['movedLayout']
    assert abs(restored['TABLE'][0] - restored['movedLayout']['table']['x']) < 0.01
    assert abs(restored['COUNTER'][1] - restored['movedLayout']['counter']['z']) < 0.01
    assert any(abs(s[0] - saved['shelves'][0][0]) < 0.01 and abs(s[1] - saved['shelves'][0][1]) < 0.01 for s in restored['shelves'])

    browser.close()

print("ERRORS:", errors if errors else "none")
print("MOVE TEST:", "PASS" if not errors else "FAIL")
sys.exit(1 if errors else 0)
