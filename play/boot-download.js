(function (root) {
  'use strict';
  const sha256 = async bytes => Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  const aborted = () => new Error('aborted');
  const MAX_DECODED_PART = 1024 * 1024;
  function gzipAvailable() {
    try { if (typeof root.DecompressionStream !== 'function') return false; new root.DecompressionStream('gzip'); return true; } catch { return false; }
  }
  function selectedParts(file) {
    if (!Array.isArray(file.parts) || !file.parts.length) throw new Error('invalid manifest');
    if (file.parts.some(part => part.encoding === 'gzip') && !gzipAvailable()) {
      if (!Array.isArray(file.fallbackParts) || !file.fallbackParts.length || file.fallbackParts.some(part => part.encoding)) throw new Error('invalid manifest fallback');
      return file.fallbackParts;
    }
    return file.parts;
  }
  function getDownloadSize(file) {
    return selectedParts(file).reduce((sum, part) => {
      if (!Number.isSafeInteger(part.size) || part.size < 1) throw new Error('invalid manifest part');
      return sum + part.size;
    }, 0);
  }
  async function decodePart(bytes, job, signal) {
    if (!job.encoding) return bytes;
    const reader = new Response(bytes).body.pipeThrough(new root.DecompressionStream('gzip')).getReader();
    const cancel = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const decoded = new Uint8Array(job.decodedSize);
    let received = 0;
    try {
      while (true) {
        if (signal.aborted) throw aborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > decoded.length) { await reader.cancel(); throw new Error('integrity decoded length'); }
        decoded.set(value, received); received += value.length;
      }
      if (signal.aborted) throw aborted();
      if (received !== decoded.length || await sha256(decoded) !== job.decodedSha256.toLowerCase()) throw new Error('integrity decoded hash/length');
      return decoded;
    } catch (error) {
      throw new Error(`integrity decode: ${error.message}`, { cause: error });
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  }
  async function downloadFiles(files, options = {}) {
    const { baseURL = root.location?.href, concurrency = 4, idleMs = 90000, attempts = 3, retryDelayMs = 750, onProgress = () => {}, onRetry = () => {}, signal } = options;
    if (!Array.isArray(files) || !files.length || !Number.isInteger(concurrency) || concurrency < 1 || attempts < 1) throw new Error('invalid manifest/options');
    const output = new Map(), jobs = [];
    for (const file of files) {
      if (output.has(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || !/^[a-f0-9]{64}$/i.test(file.sha256) || !Array.isArray(file.parts) || !file.parts.length) throw new Error('invalid manifest');
      let offset = 0;
      const parts = selectedParts(file), pending = [];
      for (const part of parts) {
        if (!Number.isSafeInteger(part.size) || part.size < 1 || !/^[a-f0-9]{64}$/i.test(part.sha256) || typeof part.url !== 'string') throw new Error('invalid manifest part');
        if (part.encoding && (part.encoding !== 'gzip' || !Number.isSafeInteger(part.decodedSize) || part.decodedSize < 1 || part.decodedSize > MAX_DECODED_PART || part.size > MAX_DECODED_PART + 65536 || !/^[a-f0-9]{64}$/i.test(part.decodedSha256))) throw new Error('invalid manifest encoding/bounds');
        pending.push({ ...part, offset, name: file.name }); offset += part.encoding ? part.decodedSize : part.size;
      }
      if (offset !== file.size) throw new Error('invalid manifest length');
      const buffer = new Uint8Array(file.size);
      for (const job of pending) jobs.push({ ...job, buffer });
      output.set(file.name, buffer);
    }
    const stop = new AbortController();
    const externalAbort = () => stop.abort();
    signal?.addEventListener('abort', externalAbort, { once: true });
    if (signal?.aborted) stop.abort();
    let next = 0, committed = 0;
    onProgress(0);
    async function read(job, attempt) {
      const request = new AbortController();
      const cancel = () => request.abort();
      stop.signal.addEventListener('abort', cancel, { once: true });
      let timer, timedOut = false;
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; request.abort(); }, idleMs); };
      try {
        if (stop.signal.aborted) throw aborted();
        touch();
        const response = await root.fetch(new URL(job.url, baseURL), { signal: request.signal, cache: attempt > 1 ? 'reload' : 'default' });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader(), bytes = new Uint8Array(job.size);
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          if (received + value.length > bytes.length) { await reader.cancel(); throw new Error('integrity length'); }
          bytes.set(value, received); received += value.length;
        }
        clearTimeout(timer);
        if (received !== job.size || (await sha256(bytes)) !== job.sha256.toLowerCase()) throw new Error('integrity hash/length');
        return await decodePart(bytes, job, stop.signal);
      } catch (error) {
        if (stop.signal.aborted) throw aborted();
        if (timedOut) throw new Error('download timeout');
        throw error;
      } finally { clearTimeout(timer); stop.signal.removeEventListener('abort', cancel); }
    }
    async function worker() {
      while (next < jobs.length) {
        if (stop.signal.aborted) throw aborted();
        const job = jobs[next++];
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const bytes = await read(job, attempt);
            if (stop.signal.aborted) throw aborted();
            job.buffer.set(bytes, job.offset); committed += job.size; onProgress(committed);
            break;
          } catch (error) {
            if (attempt === attempts || stop.signal.aborted) throw new Error(`${job.name} at ${job.offset}: ${error.message}`, { cause: error });
            onRetry({ name: job.name, url: job.url, attempt, reason: error.message });
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          }
        }
      }
    }
    try {
      // Reject only after sibling requests stop, avoiding an orphaned boot/download.
      let firstError;
      await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker().catch(error => { if (!firstError) firstError = error; stop.abort(); })));
      if (firstError) throw firstError;
      for (const file of files) if ((await sha256(output.get(file.name))) !== file.sha256.toLowerCase()) throw new Error('integrity assembled file');
      return output;
    } finally { signal?.removeEventListener('abort', externalAbort); }
  }
  async function withWasmResponse(url, bytes, action) {
    const original = root.fetch;
    const target = new URL(url, root.location?.href).href;
    root.fetch = function (input, init) {
      const requested = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (new URL(requested, root.location?.href).href === target) return Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
      return original.call(root, input, init);
    };
    try { return await action(); } finally { root.fetch = original; }
  }
  async function bootEngine(engine, config, manifest, options = {}) {
    const wasm = manifest.files?.find(file => file.name === 'index.wasm');
    const packFile = manifest.files?.find(file => file.name === 'index.pck');
    if (manifest.files?.length !== 2 || !wasm || !packFile) throw new Error('invalid boot manifest');
    const phase = options.onPhase || (() => {});
    const report = options.onProgress || (() => {});
    const wasmTransferSize = getDownloadSize(wasm);
    const checkAbort = () => { if (options.signal?.aborted) throw aborted(); };
    phase('download-engine');
    const wasmBytes = await downloadFiles([wasm], { ...options, onProgress: report });
    try {
      checkAbort();
      phase('initialize');
      let cancelInitialization;
      const interrupted = new Promise((resolve, reject) => {
        cancelInitialization = () => reject(aborted());
        options.signal?.addEventListener('abort', cancelInitialization, { once: true });
      });
      try {
        await withWasmResponse(`${config.executable}.wasm`, wasmBytes.get(wasm.name), () => Promise.race([engine.init(config.executable), interrupted]));
      } finally { options.signal?.removeEventListener('abort', cancelInitialization); }
    } finally { wasmBytes.clear(); }
    checkAbort();
    // Do not retain a whole PCK while compiling/initializing the runtime.
    phase('download-game');
    const packBytes = await downloadFiles([packFile], { ...options, onProgress: n => report(wasmTransferSize + n) });
    const pack = config.mainPack || `${config.executable}.pck`;
    try {
      checkAbort();
      phase('install');
      // Actual GodotFS wraps this in new Uint8Array(buffer). An ArrayBuffer is
      // a view there; a TypedArray would clone the entire pack once more.
      engine.copyToFS(pack, packBytes.get(packFile.name).buffer);
    } finally { packBytes.clear(); }
    checkAbort();
    phase('start');
    await engine.start({ canvas: options.canvas, args: ['--main-pack', pack, ...(config.args || [])] });
  }
  const api = { downloadFiles, withWasmResponse, bootEngine, getDownloadSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoadBootDownload = api;
})(globalThis);
