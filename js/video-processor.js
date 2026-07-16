/**
 * video-processor.js
 * Client-side video processing using ffmpeg.wasm
 * Extracts audio, processes it, and muxes it back into the video
 * Gracefully falls back to browser-native decoding if FFmpeg is unavailable (e.g. COOP/COEP header limits)
 */

const VideoProcessor = (() => {
  let ffmpeg = null;
  let isLoaded = false;
  let isLoading = false;

  /**
   * Check if a file is a video
   */
  function isVideoFile(file) {
    const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
    return videoTypes.includes(file.type) || /\.(mp4|mov|webm|avi|mkv)$/i.test(file.name);
  }

  /**
   * Lazy-load ffmpeg.wasm from CDN
   */
  async function loadFFmpeg(onProgress) {
    if (isLoaded) return;
    if (isLoading) {
      // Wait for existing load
      while (isLoading) {
        await new Promise(r => setTimeout(r, 200));
      }
      return;
    }

    isLoading = true;

    try {
      if (onProgress) onProgress('Loading video engine...');

      // Dynamic import with backup URL
      let FFmpeg, toBlobURL;
      try {
        const ffmpegModule = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm');
        const utilModule = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm');
        FFmpeg = ffmpegModule.FFmpeg;
        toBlobURL = utilModule.toBlobURL;
      } catch (cdnErr) {
        console.warn('Primary CDN failed, trying unpkg...', cdnErr);
        const ffmpegModule = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
        const utilModule = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
        FFmpeg = ffmpegModule.FFmpeg;
        toBlobURL = utilModule.toBlobURL;
      }

      ffmpeg = new FFmpeg();

      // Load core WebAssembly (try with cdn.jsdelivr.net)
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      isLoaded = true;
      if (onProgress) onProgress('Video engine ready');
    } catch (err) {
      console.warn('Could not initialize ffmpeg.wasm (likely missing COOP/COEP headers). Falling back to native browser audio extraction.', err);
      // We set isLoaded = false but don't throw an error to allow graceful browser-native audio extraction.
      isLoaded = false;
      if (onProgress) onProgress('Video engine loaded (Native fallback active)');
    } finally {
      isLoading = false;
    }
  }

  /**
   * Extract audio from a video file as WAV (falls back to native file if ffmpeg fails)
   */
  async function extractAudio(videoFile, onProgress) {
    await loadFFmpeg(onProgress);

    if (!isLoaded || !ffmpeg) {
      if (onProgress) onProgress('Extracting audio track natively...');
      // By returning the original video file directly, AudioContext.decodeAudioData
      // can read the audio channel from the video container format natively!
      return videoFile;
    }

    try {
      if (onProgress) onProgress('Reading video file...');
      const videoData = new Uint8Array(await videoFile.arrayBuffer());
      const inputName = 'input' + getExtension(videoFile.name);

      await ffmpeg.writeFile(inputName, videoData);

      if (onProgress) onProgress('Extracting audio track...');
      await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', 'extracted_audio.wav']);

      const audioData = await ffmpeg.readFile('extracted_audio.wav');

      // Clean up
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile('extracted_audio.wav');

      const audioBlob = new Blob([audioData.buffer], { type: 'audio/wav' });
      return new File([audioBlob], 'extracted_audio.wav', { type: 'audio/wav' });
    } catch (err) {
      console.warn('ffmpeg.wasm audio extraction failed, falling back to browser-native decoding:', err);
      return videoFile;
    }
  }

  /**
   * Mux cleaned audio back into the original video (falls back to direct audio if ffmpeg fails)
   */
  async function muxAudio(originalVideo, cleanedAudioBlob, onProgress) {
    await loadFFmpeg(onProgress);

    if (!isLoaded || !ffmpeg) {
      if (onProgress) onProgress('FFmpeg unavailable. Saving clean audio directly...');
      return cleanedAudioBlob;
    }

    try {
      if (onProgress) onProgress('Preparing video muxing...');

      const videoData = new Uint8Array(await originalVideo.arrayBuffer());
      const audioData = new Uint8Array(await cleanedAudioBlob.arrayBuffer());
      const inputName = 'input' + getExtension(originalVideo.name);
      const outputExt = getExtension(originalVideo.name) || '.mp4';

      await ffmpeg.writeFile(inputName, videoData);
      await ffmpeg.writeFile('cleaned_audio.wav', audioData);

      if (onProgress) onProgress('Merging audio track with video...');

      await ffmpeg.exec([
        '-i', inputName,
        '-i', 'cleaned_audio.wav',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        'output' + outputExt
      ]);

      const outputData = await ffmpeg.readFile('output' + outputExt);

      // Clean up
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile('cleaned_audio.wav');
      await ffmpeg.deleteFile('output' + outputExt);

      return new Blob([outputData.buffer], { type: originalVideo.type || 'video/mp4' });
    } catch (err) {
      console.warn('ffmpeg.wasm video muxing failed, falling back to audio-only output:', err);
      return cleanedAudioBlob;
    }
  }

  /**
   * Process a complete video file: extract → clean → mux → download
   */
  async function processVideo(videoFile, processAudioFn, onProgress) {
    const audioFile = await extractAudio(videoFile, onProgress);

    if (onProgress) onProgress('Cleaning audio track...');
    const cleanedBuffer = await processAudioFn(audioFile);

    const wavBlob = audioBufferToWavBlob(cleanedBuffer);
    const outputVideo = await muxAudio(videoFile, wavBlob, onProgress);

    return outputVideo;
  }

  /**
   * Convert AudioBuffer to WAV Blob (for muxing)
   */
  function audioBufferToWavBlob(buffer) {
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

    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function getExtension(filename) {
    const match = filename.match(/\.[^.]+$/);
    return match ? match[0].toLowerCase() : '.mp4';
  }

  return {
    isVideoFile,
    loadFFmpeg,
    extractAudio,
    muxAudio,
    processVideo,
    audioBufferToWavBlob
  };
})();
