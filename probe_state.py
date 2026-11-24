from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 900, "height": 600})
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(2000)
    info = page.evaluate("""() => {
      const PVZ = window.PVZ;
      const cells = PVZ.shelves.flatMap(s => s.cells);
      return {
        cells: cells.length,
        free: cells.filter(c => !c.parcel).length,
        parcels: PVZ.parcels.length,
        shelved: PVZ.parcels.filter(p => p.cell).length,
      };
    }""")
    print(info)
    r = page.evaluate("window.PVZ.debugForceCustomer()")
    print("force:", r, "customers:", page.evaluate("window.PVZ.customers.length"))
    browser.close()
