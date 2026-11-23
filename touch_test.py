import sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 420, "height": 760}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.tap("#btn-start")
    page.wait_for_timeout(3500)   # первая поставка

    cdp = ctx.new_cdp_session(page)

    def touch_event(t, pts):
        cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": pts})

    def touch_start(x, y, pid=1):
        touch_event("touchStart", [{"x": x, "y": y, "id": pid}])

    def touch_move(x, y, pid=1):
        touch_event("touchMove", [{"x": x, "y": y, "id": pid}])

    def touch_end():
        touch_event("touchEnd", [])

    # --- 1) плавающий джойстик в произвольном месте левой половины ---
    before = page.evaluate("[window.PVZ.player.position.x, window.PVZ.player.position.z]")
    touch_start(120, 520)
    for i in range(1, 12):
        touch_move(120 + i * 2.2, 520 - i * 3.4)
        page.wait_for_timeout(40)
    touch_end()
    page.wait_for_timeout(300)
    after = page.evaluate("[window.PVZ.player.position.x, window.PVZ.player.position.z]")
    moved = ((after[0]-before[0])**2 + (after[1]-before[1])**2) ** 0.5
    print(f"floating joystick: moved {moved:.2f} m  ({before[0]:.1f},{before[1]:.1f}) -> ({after[0]:.1f},{after[1]:.1f})")
    print("joystick hidden after release:", page.evaluate("!document.getElementById('joystick').classList.contains('show')"))

    # --- 2) левая половина НЕ берёт короб (это зона движения) ---
    box = page.evaluate("""() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); if(!it) return null; const p = it.mesh.position; window.PVZ.player.position.set(p.x + 0.9, 0, p.z); return [p.x, p.z]; }""")
    page.wait_for_timeout(200)
    if box:
        touch_start(110, 600); touch_end()   # быстрый тап в левой половине
        page.wait_for_timeout(200)
        print("left-half tap does NOT pick up:", page.evaluate("window.PVZ.G.carried") is None)

    # --- 3) правая половина ТАП = активация (взять короб руками) ---
    touch_start(330, 700); touch_end()   # тап по пустой зоне справа — активация (E)
    page.wait_for_timeout(250)
    print("right-half tap picked box:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.kind"))

    # --- 4) прозрачность кнопок: кнопка E почти непрозрачная ---
    opacity = page.evaluate("getComputedStyle(document.getElementById('btn-touch-e')).backgroundColor")
    print("E button bg:", opacity)

    page.screenshot(path="/home/user/pvz-game/shot_touch.png")
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
