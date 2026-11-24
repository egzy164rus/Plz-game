from playwright.sync_api import sync_playwright

URL = "https://egzy164rus.github.io/Plz-game/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3600)

    # крупный план: персонаж + зал с реалистичными материалами
    page.evaluate("window.PVZ.debugSetCameraDist(5.2)")
    page.evaluate("window.PVZ.applyLayout(0)")
    page.wait_for_timeout(900)
    page.screenshot(path="/home/user/pvz-game/shot_v06_close.png")

    # нормальная дистанция
    page.evaluate("window.PVZ.debugSetCameraDist(10.5)")
    page.wait_for_timeout(700)
    page.screenshot(path="/home/user/pvz-game/shot_v06_wide.png")

    # Denis + короб в руках (вскроем короба не обязательно): просто кадр с NPC
    d1 = decor_state = None
    browser.close()
print("done")
