(() => {
  const canvas = document.getElementById("canvas");
  const status = document.getElementById("loading-status");
  const progress = document.getElementById("loading-progress");
  const reload = document.getElementById("reload-game");
  const gameKeyCodes = new Set(["ArrowLeft", "ArrowRight", "Space", "KeyA", "KeyD", "KeyS", "KeyI", "KeyR", "Escape"]);
  let bootFinished = false;
  const slowBootNotice = window.setTimeout(() => {
    if (!bootFinished) {
      status.textContent = "首次載入正在下載遊戲資料，請保持此頁面開啟。";
    }
  }, 6000);
  const finishBootNotice = () => {
    bootFinished = true;
    window.clearTimeout(slowBootNotice);
  };
  const focusCanvas = () => {
    canvas.tabIndex = 0;
    canvas.focus({ preventScroll: true });
  };
  const fail = () => {
    finishBootNotice();
    status.textContent = "遊戲載入失敗，請重新載入。";
    reload.hidden = false;
  };

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
  script.onload = () => {
    const engine = new Engine(window.ROAD_RAGE_GODOT_CONFIG);
    engine.startGame({
      canvas,
      onProgress: (current, total) => {
        const percent = total > 0 ? Math.round(current * 100 / total) : 0;
        progress.value = percent;
        status.textContent = `遊戲載入中 ${percent}%`;
      },
    }).then(() => {
      finishBootNotice();
      document.getElementById("loading-panel").hidden = true;
      focusCanvas();
    }).catch(fail);
  };
  script.onerror = fail;
  document.head.appendChild(script);
})();
