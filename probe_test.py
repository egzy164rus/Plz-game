import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", e))
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_timeout(500)
    page.click("#btn-start")
    for t in [0.5, 2.0, 2.9, 3.2, 5.0]:
        page.wait_for_timeout(int(t * 100) and 500)
        info = page.evaluate("() => ({screen: PVZ.G.screen, timer: PVZ.G.deliveryTimer, big: PVZ.floorItems.filter(i=>i.kind==='big').length, money: PVZ.G.money})")
        print(f"t≈{t}s cumulative+0.5 ->", info)
    browser.close()
