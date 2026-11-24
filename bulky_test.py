import sys, json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    page.evaluate("window.PVZ.G.customerTimer = 9999")

    # 1) спавним габаритную посылку и поднимаем
    pid = page.evaluate("window.PVZ.debugSpawnParcel('bulky', -3.8, -0.9)")
    page.evaluate("window.PVZ.player.position.set(-3.0, 0, -0.9)")
    page.wait_for_timeout(300)
    page.keyboard.press("KeyE")
    page.wait_for_timeout(300)
    print("carried:", page.evaluate("window.PVZ.G.carried && window.PVZ.G.carried.kind + ':' + window.PVZ.G.carried.id"))

    # 2) к стойке «Габарит», кладём
    page.evaluate("window.PVZ.player.position.set(-6.9, 0, 2.3)")
    page.wait_for_timeout(300)
    print("interaction at rack:", page.evaluate("() => { const it = window.PVZ.getInteraction(); return it && it.label; }"))
    page.keyboard.press("KeyE")
    page.wait_for_timeout(300)
    slot = page.evaluate(f"() => {{ const p = window.PVZ.parcels.find(p=>p.id==='{pid}'); return p ? p.bulkySlot : 'GONE'; }}")
    print("bulkySlot after store:", slot)

    # 3) взять обратно
    print("interaction at rack (empty hands):", page.evaluate("() => { const it = window.PVZ.getInteraction(); return it && it.label; }"))
    page.keyboard.press("KeyE")
    page.wait_for_timeout(300)
    print("carried after take:", page.evaluate("window.PVZ.G.carried && (window.PVZ.G.carried.kind + ':' + window.PVZ.G.carried.id)"))
    print("bulkySlot after take:", page.evaluate(f"() => {{ const p = window.PVZ.parcels.find(p=>p.id==='{pid}'); return p ? p.bulkySlot : 'GONE'; }}"))

    # положим обратно и сохранимся
    page.keyboard.press("KeyE")
    page.wait_for_timeout(300)
    print("re-stored bulkySlot:", page.evaluate(f"() => {{ const p = window.PVZ.parcels.find(p=>p.id==='{pid}'); return p ? p.bulkySlot : 'GONE'; }}"))
    page.evaluate("window.PVZ.G.money = 555")
    page.click("#btn-pause"); page.wait_for_timeout(300)
    page.click("#btn-pause-save"); page.wait_for_timeout(300)
    saved = page.evaluate("JSON.parse(localStorage.getItem('pvz_save_v1_1') || 'null')")
    bulky_saved = [p for p in (saved or {}).get('parcels', []) if p.get('bulkySlot') is not None]
    print("bulky in save:", bulky_saved)

    # 4) перезагрузка → продолжить → габарит на стойке
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2500)
    restored = page.evaluate(f"() => {{ const p = window.PVZ.parcels.find(p=>p.id==='{pid}'); return p ? {{ bulkySlot: p.bulkySlot, y: +p.mesh.position.y.toFixed(2), type: p.type }} : 'GONE'; }}")
    print("restored:", restored)
    ok = isinstance(restored, dict) and restored['bulkySlot'] == 0 and restored['type'] == 'bulky'

    browser.close()

print("BULKY TEST:", "PASS" if (ok and not errors) else "FAIL")
for e in errors:
    print(" -", e)
sys.exit(0 if (ok and not errors) else 1)
