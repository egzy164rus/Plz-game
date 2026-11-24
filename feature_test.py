import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#menu:not(.hidden)", timeout=90000)
    page.click("#btn-start")
    page.wait_for_timeout(2500)

    # --- перерыв: кнопка и N ---
    print("break before:", page.evaluate("window.PVZ.G.breakOn"))
    page.click("#btn-break")
    page.wait_for_timeout(200)
    print("break after click:", page.evaluate("window.PVZ.G.breakOn"), "| btn class:", page.evaluate("document.getElementById('btn-break').className"), "| chip hidden:", page.evaluate("document.getElementById('break-chip').classList.contains('hidden')"))
    page.keyboard.press("KeyN")
    page.wait_for_timeout(200)
    print("break after N:", page.evaluate("window.PVZ.G.breakOn"), "| chip hidden:", page.evaluate("document.getElementById('break-chip').classList.contains('hidden')"))

    # заморозить естественный спавн, продавить клиента
    page.evaluate("window.PVZ.G.customerTimer = 9999")
    page.evaluate("window.PVZ.debugForceCustomer()")
    page.evaluate("window.PVZ.customers.forEach(c => { c.patience = 9999; c.patienceMax = 9999; })")
    page.wait_for_timeout(5000)
    cust = page.evaluate("window.PVZ.customers.map(c=>({state:c.state, qr:c.qrScanned}))")
    print("customers:", cust)

    # QR на стойке
    for _ in range(3):
        unscanned = page.evaluate("window.PVZ.customers.filter(c => c.state === 'waiting' && !c.isReturn && !c.qrScanned).length")
        if unscanned == 0: break
        page.evaluate("() => { window.PVZ.player.position.set(4.0, 0, 3.4); }")
        page.wait_for_timeout(250)
        page.keyboard.press("KeyE")
        page.wait_for_timeout(1400)
    print("qr:", page.evaluate("window.PVZ.customers.map(c=>c.qrScanned)"))
    page.wait_for_timeout(400)

    # --- компас: виден, id заказанный, стрелка вращается, дистанция пишется ---
    print("activeOrder:", page.evaluate("window.PVZ.G.activeOrder && window.PVZ.G.activeOrder.parcel.id"))
    compass = page.evaluate("""() => {
      const el = document.getElementById('compass');
      return { hidden: el.classList.contains('hidden'),
               id: document.getElementById('compass-id').textContent,
               dist: document.getElementById('compass-dist').textContent,
               arrow: document.getElementById('compass-arrow').style.transform };
    }""")
    print("compass:", compass)

    # --- полосы сытости/бодрости обновляются ---
    print("vitals:", page.evaluate("({ h: document.getElementById('hunger-fill').style.width, e: document.getElementById('energy-fill').style.width })"))

    # --- фаза дня на чипе ---
    print("phase chip:", page.evaluate("document.getElementById('phase-chip').textContent"))

    ok = (not errors) and compass['hidden'] is False and compass['arrow'].startswith('rotate(')
    browser.close()

print("FEATURE TEST:", "PASS" if ok else "FAIL")
for e in errors:
    print(" -", e)
sys.exit(0 if ok else 1)
