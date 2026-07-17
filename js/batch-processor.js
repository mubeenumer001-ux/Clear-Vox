/**
 * batch-processor.js
 * Multi-file batch processing queue with sequential execution
 * Restricted strictly to MP3 input and MP3 zip output
 */

const BatchProcessor = (() => {
  let queue = [];
  let isProcessing = false;
  let currentIndex = -1;
  let onUpdateCallback = null;
  let processFileFn = null;

  // File states
  const STATE = {
    QUEUED: 'queued',
    PROCESSING: 'processing',
    DONE: 'done',
    ERROR: 'error'
  };

  /**
   * Initialize batch processor
   * @param {function} processFn - Function that processes a single file: (file) => Promise<{buffer, blob}>
   * @param {function} onUpdate - Callback when queue state changes: (queue) => void
   */
  function init(processFn, onUpdate) {
    processFileFn = processFn;
    onUpdateCallback = onUpdate;
  }

  /**
   * Add files to the queue (Strictly MP3 format)
   * @param {FileList|Array<File>} files
   */
  function addFiles(files) {
    for (const file of files) {
      const isMp3 = file.type === 'audio/mpeg' || file.type === 'audio/mp3' || file.name.endsWith('.mp3');
      if (!isMp3) continue;

      queue.push({
        id: generateId(),
        file,
        state: STATE.QUEUED,
        progress: 0,
        progressText: '',
        result: null, // { buffer, blob, filename }
        error: null
      });
    }

    notifyUpdate();

    // Start processing if not already running
    if (!isProcessing && queue.some(item => item.state === STATE.QUEUED)) {
      processNext();
    }
  }

  /**
   * Process the next item in the queue
   */
  async function processNext() {
    const nextItem = queue.find(item => item.state === STATE.QUEUED);
    if (!nextItem || !processFileFn) {
      isProcessing = false;
      return;
    }

    isProcessing = true;
    currentIndex = queue.indexOf(nextItem);
    nextItem.state = STATE.PROCESSING;
    nextItem.progress = 0;
    notifyUpdate();

    try {
      const result = await processFileFn(nextItem.file, (progress, text) => {
        nextItem.progress = progress;
        nextItem.progressText = text;
        notifyUpdate();
      });

      nextItem.state = STATE.DONE;
      nextItem.progress = 100;
      nextItem.result = result;
      nextItem.progressText = 'Done ✨';
    } catch (err) {
      nextItem.state = STATE.ERROR;
      nextItem.error = err.message || 'Processing failed';
      nextItem.progressText = 'Error';
      console.error('Batch processing error:', err);
    }

    notifyUpdate();

    // Process next in queue
    await new Promise(r => setTimeout(r, 200));
    processNext();
  }

  /**
   * Remove an item from the queue
   */
  function removeItem(id) {
    const index = queue.findIndex(item => item.id === id);
    if (index === -1) return;

    // Don't remove currently processing item
    if (queue[index].state === STATE.PROCESSING) return;

    queue.splice(index, 1);
    notifyUpdate();
  }

  /**
   * Clear completed items
   */
  function clearCompleted() {
    queue = queue.filter(item => item.state !== STATE.DONE && item.state !== STATE.ERROR);
    notifyUpdate();
  }

  /**
   * Clear all items (stops processing)
   */
  function clearAll() {
    queue = [];
    isProcessing = false;
    currentIndex = -1;
    notifyUpdate();
  }

  /**
   * Download all completed files as a ZIP containing MP3s
   */
  async function downloadAllAsZip(onProgress) {
    const completedItems = queue.filter(item => item.state === STATE.DONE && item.result);
    if (completedItems.length === 0) return;

    if (onProgress) onProgress('Loading ZIP library...');

    // Lazy-load JSZip
    const JSZip = await loadJSZip();
    const zip = new JSZip();

    if (onProgress) onProgress('Creating ZIP archive...');

    for (const item of completedItems) {
      const filename = item.result.filename || `clearvox-${item.file.name.replace(/\.[^/.]+$/, '')}.mp3`;
      zip.file(filename, item.result.blob);
    }

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    }, (metadata) => {
      if (onProgress) onProgress(`Compressing... ${Math.round(metadata.percent)}%`);
    });

    // Trigger download
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clearvox-batch-${Date.now()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Lazy-load JSZip from CDN
   */
  async function loadJSZip() {
    if (window.JSZip) return window.JSZip;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => reject(new Error('Failed to load JSZip'));
      document.head.appendChild(script);
    });
  }

  /**
   * Get queue state
   */
  function getQueue() {
    return [...queue];
  }

  function getStats() {
    return {
      total: queue.length,
      queued: queue.filter(i => i.state === STATE.QUEUED).length,
      processing: queue.filter(i => i.state === STATE.PROCESSING).length,
      done: queue.filter(i => i.state === STATE.DONE).length,
      error: queue.filter(i => i.state === STATE.ERROR).length
    };
  }

  function isActive() {
    return isProcessing;
  }

  function notifyUpdate() {
    if (onUpdateCallback) onUpdateCallback(getQueue(), getStats());
  }

  function generateId() {
    return 'f_' + Math.random().toString(36).slice(2, 9);
  }

  return {
    STATE,
    init,
    addFiles,
    removeItem,
    clearCompleted,
    clearAll,
    downloadAllAsZip,
    getQueue,
    getStats,
    isActive
  };
})();
