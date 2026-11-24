from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1100, "height": 650})
    errs = []
    page.on("pageerror", lambda e: errs.append(getattr(e, 'stack', str(e)).split('\n')[0] + ' @ ' + (getattr(e, 'stack','').split('\n')[1] if '\n' in str(e) else '')))
    page.goto("https://egzy164rus.github.io/Plz-game/", wait_until="networkidle")
    page.wait_for_timeout(4000)
    print("errors on live v0.8.1:", len(errs))
    for e in errs[:4]:
        print(" -", e)
    browser.close()
