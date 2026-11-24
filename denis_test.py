from playwright.sync_api import sync_playwright
import time

URL = "http://localhost:8090/"
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3200)

    page.evaluate("window.PVZ.debugClearParcels()")
    defect_id = page.evaluate("window.PVZ.debugSpawnParcel('defect', window.PVZ.TABLE_POS.x + 1.2, window.PVZ.TABLE_POS.z + 0.9)")
    print("defect spawned:", defect_id)
    page.evaluate("window.PVZ.hireLoader()")

    t0 = time.time()
    hauled = False
    deposited = False
    while time.time() - t0 < 25:
        state = page.evaluate("""() => ({
            left: window.PVZ.parcels.filter(p => p.type === 'defect').length,
            toasts: [...document.querySelectorAll('.toast, #toast, [class*=toast]')].map(e => e.textContent).join('|')
        })""")
        if state['left'] == 0:
            hauled = True
        if 'утилизировал' in state['toasts']:
            deposited = True
            break
        page.wait_for_timeout(400)
    print("defect picked:", hauled, "| deposited into bin:", deposited, f"({time.time()-t0:.1f}s)")
    assert hauled and deposited
    page.wait_for_timeout(1500)
    assert errors == [], errors
    browser.close()
print("DENIS DEFECT TEST PASSED")
