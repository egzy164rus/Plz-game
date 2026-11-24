from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_timeout(3000)
    # повернём игрока лицом к камере
    page.evaluate("window.PVZ.player.rotation.y = Math.PI * 0.5")
    page.evaluate("window.PVZ.debugSetCameraDist(2.6)")
    page.wait_for_timeout(700)
    page.screenshot(path="/home/user/pvz-game/shot_v06_face.png")
    # Denis close-up? клиент в очереди лицом
    browser.close()
print("done")
