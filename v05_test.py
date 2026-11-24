import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(3500)

    # ---- 1) Двойная приёмка: сетка на столе + переполнение на пол
    page.evaluate("window.PVZ.debugClearParcels()")
    page.evaluate("window.PVZ.debugFillTable(6)")
    n = page.evaluate("window.PVZ.debugSpawnUnpacked()")
    state = page.evaluate("""() => window.PVZ.parcels.map(p => ({ x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z, floor: !!p.floorRow }))""")
    ys = [round(p['y'], 2) for p in state]
    floor_count = sum(1 for p in state if p['y'] < 0.1)
    # попарные расстояния среди напольных и среди настольных
    def min_dist(items):
        best = 99
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                d = ((items[i]['x']-items[j]['x'])**2 + (items[i]['y']-items[j]['y'])**2 + (items[i]['z']-items[j]['z'])**2) ** 0.5
                best = min(best, d)
        return best
    grid_items = [p for p in state if abs(p['y'] - 0.96) < 0.05]
    pile_items = [p for p in state if p['y'] > 1.2]
    floor_items = [p for p in state if p['y'] < 0.1]
    print(f"parcels after 2nd reception: {n} | grid: {len(grid_items)} | pile: {len(pile_items)} | floor: {len(floor_items)}")
    print(f"grid min pairwise dist: {min_dist(grid_items):.2f} m")
    assert len(grid_items) == 8, grid_items
    assert len(pile_items) == n - 8, state
    assert len(floor_items) == 0, state
    assert min_dist(grid_items) > 0.5
    page.evaluate("window.PVZ.debugClearParcels()")

    # ---- 2) Планировки: декор и оттенки
    decor_counts = page.evaluate("""() => {
      const counts = {};
      window.PVZ.scene.traverse(o => {
        if (o.name && o.name.startsWith('decor-')) counts[o.name] = (counts[o.name] || 0) + 1;
      });
      return counts;
    }""")
    print("decor @Классика:", decor_counts)
    assert decor_counts.get('decor-clock') == 1 and decor_counts.get('decor-lamp') == 1

    def decor_after(idx):
        page.evaluate(f"window.PVZ.applyLayout({idx})")
        page.wait_for_timeout(300)
        return page.evaluate("""() => {
          const counts = {};
          window.PVZ.scene.traverse(o => { if (o.name && o.name.startsWith('decor-')) counts[o.name] = (counts[o.name] || 0) + 1; });
          return counts;
        }""")

    d1 = decor_after(1)
    print("decor @Витрина:", d1)
    assert d1.get('decor-vitrine') == 2
    assert 'decor-clock' not in d1

    d2 = decor_after(2)
    print("decor @Open space:", d2)
    assert d2.get('decor-screen') == 2 and d2.get('decor-plant') == 2

    d3 = decor_after(3)
    print("decor @Флагман:", d3)
    assert d3.get('decor-column') == 2 and d3.get('decor-runner') == 1 and d3.get('decor-pendant') == 3

    d0 = decor_after(0)
    print("decor back @Классика:", d0)
    assert d0.get('decor-clock') == 1

    # ---- 3) fx-строки рендерятся в карточке: ставим «Витрина», открываем и проверяем эффект
    page.evaluate("window.PVZ.applyLayout(1)")
    page.click("#btn-loc")
    page.wait_for_timeout(300)
    fx = page.evaluate("() => [...document.querySelectorAll('.loc-fx')].map(e => e.textContent)")
    print("fx lines:", fx)
    assert any('средний чек +15%' in t for t in fx), fx
    page.click("#btn-loc-close")
    page.wait_for_timeout(200)
    browser.close()

if errors:
    print("ERRORS:", errors[:6])
    raise SystemExit(1)
print("V05 TEST PASSED")
