import sys
from playwright.sync_api import sync_playwright

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(
        viewport={"width": 390, "height": 780},
        has_touch=True,
        is_mobile=True,
        device_scale_factor=2,
    )
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.tap("#btn-start")
    page.wait_for_timeout(800)

    touch_ui_visible = page.evaluate("!document.getElementById('touch-ui').classList.contains('hidden')")
    print("touch UI visible:", touch_ui_visible)

    pos0 = page.evaluate("window.PVZ.player.position.toArray()")
    page.evaluate("""() => {
        const js = document.getElementById('joystick');
        const r = js.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        js.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 7, clientX: cx, clientY: cy, bubbles: true}));
        js.dispatchEvent(new PointerEvent('pointermove', {pointerId: 7, clientX: cx, clientY: cy - 70, bubbles: true}));
    }""")
    page.wait_for_timeout(1500)
    pos1 = page.evaluate("window.PVZ.player.position.toArray()")
    moved = pos0[2] - pos1[2]
    print(f"player moved toward -z by: {moved:.2f} m (pos0 z={pos0[2]:.2f} -> pos1 z={pos1[2]:.2f})")
    print("JOYSTICK WORKS:", moved > 0.5)

    page.evaluate("""() => {
        const js = document.getElementById('joystick');
        js.dispatchEvent(new PointerEvent('pointerup', {pointerId: 7, bubbles: true}));
    }""")
    page.wait_for_timeout(300)
    vel0 = page.evaluate("window.PVZ.player.position.toArray()")
    page.wait_for_timeout(600)
    vel1 = page.evaluate("window.PVZ.player.position.toArray()")
    print("player stops after release:", abs(vel0[2] - vel1[2]) < 0.01)

    # Кнопка E: у паллеты открывается подсказка поднятия, тапим — короб в руках
    page.wait_for_timeout(2500)  # ждём поставку (≈3с от старта)
    page.evaluate("""() => {
        const it = window.PVZ.floorItems.find(i=>i.kind==='big');
        if (it) window.PVZ.player.position.set(it.mesh.position.x + 0.9, 0, it.mesh.position.z);
    }""")
    page.wait_for_timeout(200)
    prompt = page.evaluate("document.getElementById('interact-text').textContent")
    print("prompt near box:", prompt)
    page.tap("#btn-touch-e")
    page.wait_for_timeout(200)
    print("carried after tap E:", page.evaluate("window.PVZ.G.carried ? window.PVZ.G.carried.kind : null"))

    page.screenshot(path="/home/user/pvz-game/shot_touch.png")
    browser.close()

print("ERRORS:" if errors else "NO PAGE ERRORS")
for e in errors:
    print(" -", e)
sys.exit(1 if errors else 0)
