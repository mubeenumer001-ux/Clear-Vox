/**
 * export.js
 * Export cleaned audio as MP3 only
 * MP3 encoding via lamejs (lazy-loaded from CDN)
 */

const AudioExporter = (() => {
  /**
   * Export audio directly to MP3 320kbps
   * @param {AudioBuffer} buffer - Cleaned AudioBuffer
   * @param {string} filename - Original file name
   * @param {function} onProgress - Progress reporting callback
   */
  async function exportAudio(buffer, filename, onProgress) {
    if (onProgress) onProgress('Encoding high-quality MP3 (320kbps)...');
    
    const mp3Blob = await encodeMP3(buffer, 320);
    const baseName = filename.replace(/\.[^/.]+$/, '');
    const outputName = `${baseName}-clearvox.mp3`;

    triggerDownload(mp3Blob, outputName);
    return { blob: mp3Blob, filename: outputName };
  }

  /**
   * Encode AudioBuffer as MP3 using lamejs
   */
  async function encodeMP3(buffer, kbps = 320) {
    const lamejs = await loadLame();

    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;

    // Get channel data as Int16
    const left = floatTo16BitPCM(buffer.getChannelData(0));
    const right = numChannels > 1 ? floatTo16BitPCM(buffer.getChannelData(1)) : left;

    const mp3Encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
    const mp3Data = [];

    const blockSize = 1152;
    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      const rightChunk = right.subarray(i, i + blockSize);

      let mp3buf;
      if (numChannels === 1) {
        mp3buf = mp3Encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }

    // Flush remaining bytes
    const end = mp3Encoder.flush();
    if (end.length > 0) {
      mp3Data.push(end);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  /**
   * Convert Float32Array to Int16Array
   */
  function floatTo16BitPCM(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  /**
   * Lazy-load lamejs from CDN
   */
  async function loadLame() {
    if (window.lamejs) return window.lamejs;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
      script.onload = () => {
        if (window.lamejs) {
          resolve(window.lamejs);
        } else {
          resolve({ Mp3Encoder: window.Mp3Encoder || window.lamejs?.Mp3Encoder });
        }
      };
      script.onerror = () => reject(new Error('Failed to load MP3 encoder'));
      document.head.appendChild(script);
    });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function generateFilename(originalName) {
    return originalName.replace(/\.[^/.]+$/, '') + '-clearvox-cleaned.mp3';
  }

  /**
   * Send MP3 Blob to a webhook URL via FormData POST
   * @param {Blob} mp3Blob - The encoded MP3 blob
   * @param {string} filename - The output filename
   * @param {string} webhookUrl - The target webhook URL
   * @returns {Promise<{ok: boolean, status: number, statusText: string}>}
   */
  async function sendToWebhook(mp3Blob, filename, webhookUrl) {
    if (!mp3Blob) throw new Error('No MP3 data to send');
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      throw new Error('Invalid webhook URL');
    }

    const formData = new FormData();
    formData.append('file', mp3Blob, filename);
    formData.append('filename', filename);
    formData.append('source', 'ClearVox');
    formData.append('timestamp', new Date().toISOString());

    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText
    };
  }

  return {
    exportAudio,
    encodeMP3,
    generateFilename,
    sendToWebhook
  };
})();
