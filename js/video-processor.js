/**
 * video-processor.js
 * Client-side video processing using ffmpeg.wasm
 * Extracts audio, processes it, and muxes it back into the video
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

      // Dynamically import ffmpeg.wasm
      const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm');
      const { toBlobURL } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm');

      ffmpeg = new FFmpeg();

      // Load core
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      isLoaded = true;
      if (onProgress) onProgress('Video engine ready');
    } catch (err) {
      console.error('Failed to load ffmpeg.wasm:', err);
      throw new Error('Could not load video processing engine. Please try again.');
    } finally {
      isLoading = false;
    }
  }

  /**
   * Extract audio from a video file as WAV
   * @param {File} videoFile
   * @param {function} onProgress
   * @returns {File} - Audio file (WAV)
   */
  async function extractAudio(videoFile, onProgress) {
    await loadFFmpeg(onProgress);

    if (onProgress) onProgress('Reading video file...');

    const videoData = new Uint8Array(await videoFile.arrayBuffer());
    const inputName = 'input' + getExtension(videoFile.name);

    await ffmpeg.writeFile(inputName, videoData);

    if (onProgress) onProgress('Extracting audio...');

    await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', 'extracted_audio.wav']);

    const audioData = await ffmpeg.readFile('extracted_audio.wav');

    // Clean up
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile('extracted_audio.wav');

    const audioBlob = new Blob([audioData.buffer], { type: 'audio/wav' });
    return new File([audioBlob], 'extracted_audio.wav', { type: 'audio/wav' });
  }

  /**
   * Mux cleaned audio back into the original video
   * @param {File} originalVideo - Original video file
   * @param {Blob} cleanedAudioBlob - Cleaned audio as WAV blob
   * @param {function} onProgress
   * @returns {Blob} - New video with cleaned audio
   */
  async function muxAudio(originalVideo, cleanedAudioBlob, onProgress) {
    await loadFFmpeg(onProgress);

    if (onProgress) onProgress('Preparing video...');

    const videoData = new Uint8Array(await originalVideo.arrayBuffer());
    const audioData = new Uint8Array(await cleanedAudioBlob.arrayBuffer());
    const inputName = 'input' + getExtension(originalVideo.name);
    const outputExt = getExtension(originalVideo.name) || '.mp4';

    await ffmpeg.writeFile(inputName, videoData);
    await ffmpeg.writeFile('cleaned_audio.wav', audioData);

    if (onProgress) onProgress('Merging cleaned audio with video...');

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
  }

  /**
   * Process a complete video file: extract → clean → mux → download
   */
  async function processVideo(videoFile, processAudioFn, onProgress) {
    // Step 1: Extract audio
    const audioFile = await extractAudio(videoFile, onProgress);

    // Step 2: Process audio through ClearVox pipeline (provided callback)
    if (onProgress) onProgress('Cleaning audio...');
    const cleanedBuffer = await processAudioFn(audioFile);

    // Step 3: Convert cleaned buffer to WAV blob
    const wavBlob = audioBufferToWavBlob(cleanedBuffer);

    // Step 4: Mux back
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
