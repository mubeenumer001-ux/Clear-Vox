/**
 * export.js
 * Export cleaned audio as WAV or MP3
 * MP3 encoding via lamejs (lazy-loaded from CDN)
 */

const AudioExporter = (() => {
  let lameEncoder = null;

  /**
   * Export audio in the selected format
   * @param {AudioBuffer} buffer
   * @param {string} filename
   * @param {string} format - 'wav', 'mp3-128', 'mp3-320'
   * @param {function} onProgress
   */
  async function exportAudio(buffer, filename, format = 'wav', onProgress) {
    let blob;
    let ext;

    switch (format) {
      case 'mp3-128':
        if (onProgress) onProgress('Encoding MP3 (128kbps)...');
        blob = await encodeMP3(buffer, 128);
        ext = '.mp3';
        break;
      case 'mp3-320':
        if (onProgress) onProgress('Encoding MP3 (320kbps)...');
        blob = await encodeMP3(buffer, 320);
        ext = '.mp3';
        break;
      case 'wav':
      default:
        blob = audioBufferToWav(buffer);
        ext = '.wav';
        break;
    }

    const baseName = filename.replace(/\.[^/.]+$/, '');
    const outputName = `${baseName}-clearvox${ext}`;

    triggerDownload(blob, outputName);
    return { blob, filename: outputName };
  }

  /**
   * Encode AudioBuffer as MP3 using lamejs
   */
  async function encodeMP3(buffer, kbps = 128) {
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

    // Flush remaining
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
          // lamejs sometimes attaches differently
          resolve({ Mp3Encoder: window.Mp3Encoder || window.lamejs?.Mp3Encoder });
        }
      };
      script.onerror = () => reject(new Error('Failed to load MP3 encoder'));
      document.head.appendChild(script);
    });
  }

  /**
   * Convert AudioBuffer to WAV Blob
   */
  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;

    let interleaved;
    if (numChannels === 2) {
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      interleaved = new Float32Array(left.length + right.length);
      for (let i = 0, j = 0; i < left.length; i++, j += 2) {
        interleaved[j] = left[i];
        interleaved[j + 1] = right[i];
      }
    } else {
      interleaved = buffer.getChannelData(0);
    }

    const dataLength = interleaved.length * (bitDepth / 8);
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
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

  /**
   * Generate filename from original
   */
  function generateFilename(originalName) {
    return originalName.replace(/\.[^/.]+$/, '') + '-clearvox-cleaned.wav';
  }

  /**
   * Get available export formats
   */
  function getFormats() {
    return [
      { id: 'wav', label: 'WAV (Lossless)', desc: 'Best quality, large file' },
      { id: 'mp3-320', label: 'MP3 320kbps', desc: 'High quality, smaller file' },
      { id: 'mp3-128', label: 'MP3 128kbps', desc: 'Good quality, smallest file' }
    ];
  }

  return {
    exportAudio,
    audioBufferToWav,
    generateFilename,
    getFormats
  };
})();
