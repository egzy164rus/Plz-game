from playwright.sync_api import sync_playwright

URL = "http://localhost:8090/"
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#btn-start", state="visible", timeout=30000)
    page.click("#btn-start")
    page.wait_for_function("window.PVZ && PVZ.shelves.length > 0", timeout=30000)
    page.wait_for_timeout(600)

    # держатель, компенсирующий принудительный поворот очереди (PI): лицо к камере
    page.evaluate("""() => {
      const PVZ = window.PVZ;
      PVZ.G.customerTimer = 9999;
      PVZ.debugForceCustomer();
      const c = PVZ.customers[0];
      const slot = PVZ.QUEUE_SLOTS[0];
      c.state = 'waiting';
      c.wpIndex = 99;
      c.mesh.position.set(0, 0, 0);
      c.mesh.rotation.y = 0;
      const holder = new THREE.Group();
      holder.position.set(slot.x, 0, slot.z);
      holder.rotation.y = Math.PI;
      PVZ.scene.add(holder);
      holder.add(c.mesh);
      PVZ.player.position.set(slot.x, 0, slot.z - 1.3);
      PVZ.player.visible = false;
      PVZ.debugSetCameraDist(2.45);
    }""")
    for name, frac in [("happy", 0.85), ("neutral", 0.45), ("angry", 0.12)]:
        page.evaluate(f"""() => {{
          const c = window.PVZ.customers[0];
          c.patience = c.patienceMax * {frac};
        }}""")
        page.wait_for_timeout(600)
        mood = page.evaluate("window.PVZ.customers[0].faceMood")
        print(name, "->", mood)
        page.screenshot(path=f"/home/user/pvz-game/shot_v08_face_{name}.png")
    browser.close()
print("done")
