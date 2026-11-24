import sys, json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

def dump(page):
    return page.evaluate("""() => ({
      money: window.PVZ.G.money, day: window.PVZ.G.day,
      parcels: window.PVZ.parcels.length,
      shelved: window.PVZ.parcels.filter(p=>p.cell).length,
      slotKeys: Object.keys(localStorage).filter(k=>k.startsWith('pvz_save')),
    })""")

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)
    page.on("dialog", lambda d: d.accept())

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    print("slot chips:", page.evaluate("[...document.querySelectorAll('.slot-chip')].map(e=>e.textContent.trim().replace(/\\s+/g,' '))"))
    print("btn-start text (empty):", page.text_content("#btn-start").strip())

    page.click("#btn-start")
    page.wait_for_timeout(2500)
    # поставка: взять короб, ТТН, распаковать (как в deep_test)
    for _ in range(20):
        n = page.evaluate("window.PVZ.floorItems.filter(i=>i.kind==='big').length")
        if n >= 1: break
        page.wait_for_timeout(500)
    page.evaluate("""() => { const it = window.PVZ.floorItems.find(i=>i.kind==='big'); if(it) window.PVZ.player.position.set(it.mesh.position.x + 0.9, 0, it.mesh.position.z); }""")
    page.wait_for_timeout(300)
    page.keyboard.press("KeyE"); page.wait_for_timeout(300)
    page.evaluate("window.PVZ.player.position.set(-3.6, 0, -0.9)"); page.wait_for_timeout(300)
    page.keyboard.press("KeyE"); page.wait_for_timeout(1300)   # ТТН
    page.keyboard.press("KeyE"); page.wait_for_timeout(2600)   # распаковка
    n_par = page.evaluate("window.PVZ.parcels.length")
    print("parcels after unpack:", n_par)
    assert n_par >= 3

    # разложить одну посылку в ячейку
    taken = page.evaluate("""() => { const it = window.PVZ.floorItems.find(i=>i.kind==='parcel'); if(!it) return null; window.PVZ.player.position.set(it.mesh.position.x + 0.8, 0, it.mesh.position.z); return it.id; }""")
    page.wait_for_timeout(200); page.keyboard.press("KeyE"); page.wait_for_timeout(200)
    cell = page.evaluate("""() => { for (const s of window.PVZ.shelves) for (const c of s.cells) if (!c.parcel) return [c.x, c.z]; return null; }""")
    page.evaluate(f"() => {{ window.PVZ.player.position.set({cell[0]}, 0, {cell[1]} + 0.9); }}")
    page.wait_for_timeout(200); page.keyboard.press("KeyE"); page.wait_for_timeout(300)
    shelved = page.evaluate("window.PVZ.parcels.filter(p=>p.cell).length")
    shelved_id = page.evaluate("window.PVZ.parcels.find(p=>p.cell).id")
    print("shelved before save:", shelved, shelved_id)

    page.evaluate("window.PVZ.G.money = 777")
    page.evaluate("window.PVZ.G.customerTimer = 9999")

    # сохранение через паузу
    page.click("#btn-pause"); page.wait_for_timeout(400)
    page.click("#btn-pause-save"); page.wait_for_timeout(400)
    saved = page.evaluate("JSON.parse(localStorage.getItem('pvz_save_v1_1') || 'null')")
    print("save key present:", saved is not None, "| saved parcels:", len(saved['parcels']) if saved else None,
          "| shelved in save:", sum(1 for p in (saved['parcels'] if saved else []) if 'cell' in p),
          "| money:", saved['money'] if saved else None, "| day:", saved['day'] if saved else None)

    # --- перезагрузка: слот должен показать сохранение, Продолжить восстанавливает ---
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    print("slot chips after reload:", page.evaluate("[...document.querySelectorAll('.slot-chip')].map(e=>e.textContent.trim().replace(/\\s+/g,' '))"))
    print("btn-start text (filled):", page.text_content("#btn-start").strip())
    print("slot-info:", page.text_content("#slot-info").strip())

    page.click("#btn-start")
    page.wait_for_timeout(2500)
    state = dump(page)
    print("after continue:", state)
    restored_id = page.evaluate("window.PVZ.parcels.find(p=>p.cell) && window.PVZ.parcels.find(p=>p.cell).id")
    print("restored shelved parcel id matches:", restored_id == shelved_id, restored_id, "vs", shelved_id)
    ok = (state['money'] == 777 and state['day'] == 1 and state['shelved'] == 1 and restored_id == shelved_id)

    # --- стирание слота ---
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-erase-slot")           # confirm → accept
    page.wait_for_timeout(400)
    print("after erase:", page.evaluate("[...document.querySelectorAll('.slot-chip')].map(e=>e.textContent.trim().replace(/\\s+/g,' '))"),
          "| btn-start:", page.text_content("#btn-start").strip())
    erased = page.evaluate("localStorage.getItem('pvz_save_v1_1')") is None
    print("save key removed:", erased)

    browser.close()

print("SAVE TEST:", "PASS" if (ok and erased and not errors) else "FAIL")
for e in errors:
    print(" -", e)
sys.exit(0 if (ok and erased and not errors) else 1)
