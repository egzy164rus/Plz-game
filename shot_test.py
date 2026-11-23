from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto("http://localhost:8090/", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.click("#btn-start")
    page.wait_for_timeout(5500)   # поставка прибудет, короб будет виден
    page.keyboard.down("KeyW"); page.wait_for_timeout(400); page.keyboard.up("KeyW")
    page.screenshot(path="/home/user/pvz-game/shot_v02.png")
    # экран итогов дня — форс через консоль не выйдет, просто магазин
    page.keyboard.press("KeyB")
    page.wait_for_timeout(400)
    page.screenshot(path="/home/user/pvz-game/shot_shop.png")
    browser.close()
print("done")
