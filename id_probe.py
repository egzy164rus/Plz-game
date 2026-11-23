import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page()
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_timeout(600)
    # юнит-проверка genOrderId через 60 последовательных вызовов невозможно (нет доступа),
    # лучше проверим реальное вскрытие: форсим спавн короба и вскрываем
    page.click("#btn-start")
    page.wait_for_timeout(200)
    # силой спавним свой короб через подмену поставки нельзя — подождём штатную (3с)
    page.wait_for_timeout(3500)
    # телепорт к коробу и поднять
    page.evaluate("() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); window.PVZ.player.position.set(it.mesh.position.x + 0.9, 0, it.mesh.position.z); }")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(150)
    page.evaluate("() => { window.PVZ.player.position.set(-3.6, 0, -0.9); }")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyE")  # ТТН
    page.wait_for_timeout(1100)
    page.keyboard.press("KeyE")  # распаковка
    page.wait_for_timeout(2600)
    ids = page.evaluate("() => window.PVZ.parcels.map(p => p.id)")
    print("IDs from one unpack:", ids, "| unique:", len(ids) == len(set(ids)))
    browser.close()
sys.exit(0)
