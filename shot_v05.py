from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3300)

    def shot(idx, path):
        page.evaluate(f"window.PVZ.applyLayout({idx})")
        page.wait_for_timeout(1400)
        page.screenshot(path=path)

    shot(0, "/home/user/pvz-game/shot_v05_classic.png")
    shot(1, "/home/user/pvz-game/shot_v05_vitrina.png")
    shot(2, "/home/user/pvz-game/shot_v05_openspace.png")
    shot(3, "/home/user/pvz-game/shot_v05_flagship.png")
    # модалка с fx-строкой
    page.evaluate("window.PVZ.applyLayout(3)")
    page.click("#btn-loc")
    page.wait_for_timeout(350)
    page.screenshot(path="/home/user/pvz-game/shot_v05_fx.png")
    browser.close()
print("done")
