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
  let firstFrameWasDrawn = false;
  let resolveFirstFrame;
  window.addEventListener("road-game-first-frame", () => {
    if (controller.signal.aborted) return;
    firstFrameWasDrawn = true;
    resolveFirstFrame?.();
  }, { once: true });
  const waitForFirstFrame = () => {
    if (firstFrameWasDrawn) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const abort = () => {
        resolveFirstFrame = undefined;
        reject(new Error("aborted"));
      };
      resolveFirstFrame = () => {
        controller.signal.removeEventListener("abort", abort);
        resolveFirstFrame = undefined;
        resolve();
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted) abort();
    });
  };
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
      await RoadBootDownload.bootEngine(engine, config, manifest, {
        baseURL: new URL(window.ROAD_RAGE_BOOT_MANIFEST, location.href).href,
        signal: controller.signal,
        canvas,
        onPhase: phase => {
          window.clearTimeout(initializationTimer);
          const labels = {
            'download-engine': '正在下載遊戲引擎',
            initialize: '正在初始化遊戲引擎',
            'download-game': '正在下載遊戲內容',
            install: '正在準備遊戲內容',
            start: '正在開啟遊戲畫面',
          };
          status.textContent = labels[phase];
          detail.textContent = '採分階段載入，降低手機啟動時的記憶體負擔。請保持此頁面開啟。';
          if (!phase.startsWith('download')) {
            progress.removeAttribute('value');
            initializationTimer = window.setTimeout(() => fail(new Error('initialization timeout')), 180000);
          }
        },
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
      status.textContent = "正在顯示遊戲首畫面";
      detail.textContent = "遊戲資料已準備完成，正在建立主選單。請保持此頁面開啟。";
      progress.removeAttribute("value");
      await waitForFirstFrame();
      if (controller.signal.aborted) throw new Error("aborted");
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
