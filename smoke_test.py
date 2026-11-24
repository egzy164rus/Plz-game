import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error",) else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.screenshot(path="/home/user/pvz-game/shot_menu.png")

    # Старт игры
    page.click("#btn-start")
    page.wait_for_timeout(500)

    pos0 = page.evaluate("window.PVZ.player.position.toArray()")
    # Идём вперёд (вглубь магазина) и влево, к паллете
    page.keyboard.down("KeyW")
    page.wait_for_timeout(1200)
    page.keyboard.up("KeyW")
    page.keyboard.down("KeyA")
    page.wait_for_timeout(1200)
    page.keyboard.up("KeyA")
    pos1 = page.evaluate("window.PVZ.player.position.toArray()")
    print("player pos before:", pos0)
    print("player pos after: ", pos1)
    moved = (abs(pos0[0]-pos1[0]) + abs(pos0[2]-pos1[2])) > 0.5
    print("MOVED:", moved)

    # Ждём поставку (первая на ~3-й секунде после старта)
    page.wait_for_timeout(3000)
    boxes = page.evaluate("window.PVZ.G ? document.querySelectorAll('canvas').length : -1")
    print("canvases:", boxes)
    nBig = page.evaluate("window.PVZ.parcels.length")
    print("parcels in world (should be 0 before unpack):", nBig)

    page.screenshot(path="/home/user/pvz-game/shot_game.png")

    # Тест телепорта к коробу и взаимодействия: поднять короб
    page.evaluate("() => { const it = window.PVZ; return true; }")
    # Подсвечиваем: симулируем нажатие E у паллеты через прямую проверку подсказки
    page.wait_for_timeout(500)
    prompt_visible = page.evaluate("!document.getElementById('interact-prompt').classList.contains('hidden')")
    prompt_text = page.evaluate("document.getElementById('interact-text').textContent")
    print("prompt visible after walk:", prompt_visible, "|", prompt_text)

    # Скриншот HUD
    page.screenshot(path="/home/user/pvz-game/shot_game2.png")

    # Магазин открывается клавишей B
    page.keyboard.press("KeyB")
    page.wait_for_timeout(400)
    shop_visible = page.evaluate("!document.getElementById('shop').classList.contains('hidden')")
    print("shop opens with B:", shop_visible)
    page.keyboard.press("KeyB")
    page.wait_for_timeout(300)

    page.wait_for_timeout(1500)
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
