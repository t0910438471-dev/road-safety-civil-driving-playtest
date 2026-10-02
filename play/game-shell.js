(() => {
  const canvas = document.getElementById("canvas");
  const status = document.getElementById("loading-status");
  const progress = document.getElementById("loading-progress");
  const reload = document.getElementById("reload-game");
  const detail = document.getElementById("loading-detail");
  const panel = document.getElementById("loading-panel");
  const controller = new AbortController();
  let initializationTimer;
  const gameKeyCodes = new Set(["ArrowLeft", "ArrowRight", "Space", "KeyA", "KeyD", "KeyS", "KeyI", "KeyR", "Escape"]);
  let bootFinished = false;
  const slowBootNotice = window.setTimeout(() => {
    if (!bootFinished) {
      detail.textContent = "正在下載或初始化遊戲資料，請保持此頁面開啟。";
    }
  }, 6000);
  const finishBootNotice = () => {
    bootFinished = true;
    window.clearTimeout(slowBootNotice);
    window.clearTimeout(initializationTimer);
  };
  const focusCanvas = () => {
    canvas.tabIndex = 0;
    canvas.focus({ preventScroll: true });
  };
  const fail = (error) => {
    if (bootFinished) return;
    console.error("遊戲啟動診斷", error);
    controller.abort();
    finishBootNotice();
    status.textContent = "遊戲尚未啟動";
    detail.textContent = error?.message === "unsupported" ? "此瀏覽器無法啟動遊戲。請從手機的 Safari 或 Chrome 開啟連結。" : "下載或初始化未完成，請檢查網路後重試。已下載的分段可沿用瀏覽器快取。";
    reload.hidden = false;
  };
  window.addEventListener("unhandledrejection", event => { if (!bootFinished) fail(event.reason); });
  window.addEventListener("error", event => { if (!bootFinished && event.error) fail(event.error); });

  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", focusCanvas, { passive: true });
  canvas.addEventListener("touchstart", focusCanvas, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (document.activeElement === canvas && gameKeyCodes.has(event.code)) {
      event.preventDefault();
    }
  }, { capture: true });

  reload.addEventListener("click", () => location.reload());
  document.getElementById("home-game").addEventListener("click", () => {
    location.href = "../";
  });
  document.getElementById("fullscreen-game").addEventListener("click", () => {
    focusCanvas();
    if (canvas.requestFullscreen) {
      canvas.requestFullscreen().catch(() => {});
    }
  });
  document.getElementById("pause-game").addEventListener("click", () => {
    focusCanvas();
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  });

  const script = document.createElement("script");
  script.src = window.ROAD_RAGE_GODOT_URL;
  script.onload = async () => {
    try {
      window.clearTimeout(initializationTimer);
      if (Engine.getMissingFeatures({ threads: false }).length || !window.crypto?.subtle) throw new Error("unsupported");
      const config = window.ROAD_RAGE_GODOT_CONFIG;
      const engine = new Engine(config);
      status.textContent = "準備下載遊戲資料";
      initializationTimer = window.setTimeout(() => controller.abort(), 30000);
      const response = await fetch(window.ROAD_RAGE_BOOT_MANIFEST, { signal: controller.signal });
      if (!response.ok) throw new Error("manifest unavailable");
      const manifest = await response.json();
      window.clearTimeout(initializationTimer);
      const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
      const bytes = await RoadBootDownload.downloadFiles(manifest.files, {
        baseURL: new URL(window.ROAD_RAGE_BOOT_MANIFEST, location.href).href,
        signal: controller.signal,
        onProgress: current => {
          const percent = Math.floor(current * 100 / total);
          progress.value = percent;
          status.textContent = `下載遊戲資料 ${percent}%`;
          detail.textContent = `${(current / 1000000).toFixed(1)} / ${(total / 1000000).toFixed(1)} MB・請保持此頁面開啟`;
        },
        onRetry: ({ name, url, attempt, reason }) => {
          console.warn("遊戲下載重試", name, url, attempt, reason);
          detail.textContent = "網路暫時中斷，正在重試該段資料，已完成進度會保留。";
        },
      });
      if (controller.signal.aborted) throw new Error("aborted");
      status.textContent = "資料下載完成，正在啟動遊戲";
      detail.textContent = "首次啟動需要初始化，請稍候。";
      progress.removeAttribute("value");
      initializationTimer = window.setTimeout(() => fail(new Error("initialization timeout")), 180000);
      const pack = config.mainPack || `${config.executable}.pck`;
      await engine.preloadFile(bytes.get("index.pck"), pack);
      let cancelInitialization;
      const initializationAborted = new Promise((resolve, reject) => {
        cancelInitialization = () => reject(new Error("aborted"));
        controller.signal.addEventListener("abort", cancelInitialization, { once: true });
      });
      try {
        await RoadBootDownload.withWasmResponse(`${config.executable}.wasm`, bytes.get("index.wasm"), () => Promise.race([engine.init(config.executable), initializationAborted]));
      } finally { controller.signal.removeEventListener("abort", cancelInitialization); }
      if (controller.signal.aborted) throw new Error("aborted");
      await engine.start({ canvas, args: ["--main-pack", pack, ...(config.args || [])] });
      bytes.clear();
      finishBootNotice();
      panel.hidden = true;
      document.body.classList.add("game-ready");
      focusCanvas();
    } catch (error) { fail(error); }
  };
  script.onerror = fail;
  initializationTimer = window.setTimeout(() => fail(new Error("script timeout")), 30000);
  document.head.appendChild(script);
})();
