/**
 * audio-engine.js
 * Core audio engine — manages processing pipeline, presets, and playback
 */

const AudioEngine = (() => {
  let audioContext = null;
  let originalBuffer = null;
  let cleanedBuffer = null;
  let sourceNode = null;
  let analyserNode = null;
  let gainNode = null;

  let isPlaying = false;
  let isShowingCleaned = true;
  let startTime = 0;
  let pauseOffset = 0;

  // ---- Settings ----
  let settings = {
    noiseEnabled: true,
    noiseAmount: 0.7,
    noiseThreshold: 0.5,
    noiseCalibrate: 0.0,
    manualNoiseProfile: null,
    eqEnabled: true,
    eqAmount: 0.5,
    reverbEnabled: true,
    reverbAmount: 0.5,
    levelEnabled: true,
    deEsserEnabled: false,
    deEsserAmount: 0.5,
    silenceTrimEnabled: false,
    silenceTrimMode: 'compress', // 'compress' or 'remove'
    silenceTrimSensitivity: 0.5,
    hissEnabled: false,
    hissAmount: 0.0
  };

  // ---- Presets ----
  const PRESETS = {
    custom: {
      name: 'Custom',
      icon: '⚙️',
      desc: 'Your custom settings',
      settings: null // Uses current slider values
    },
    gamer: {
      name: 'Gamer',
      icon: '🎮',
      desc: 'PC fan & keyboard noise',
      settings: {
        noiseEnabled: true, noiseAmount: 0.9, noiseThreshold: 0.7, noiseCalibrate: 0.0, manualNoiseProfile: null,
        eqEnabled: true, eqAmount: 0.4,
        reverbEnabled: true, reverbAmount: 0.3,
        deEsserEnabled: false, deEsserAmount: 0.5,
        levelEnabled: true,
        silenceTrimEnabled: false, silenceTrimMode: 'compress', silenceTrimSensitivity: 0.5,
        hissEnabled: false, hissAmount: 0.0
      }
    },
    outdoor: {
      name: 'Outdoor Vlog',
      icon: '🌿',
      desc: 'Wind & traffic noise',
      settings: {
        noiseEnabled: true, noiseAmount: 0.95, noiseThreshold: 0.8, noiseCalibrate: 0.0, manualNoiseProfile: null,
        eqEnabled: true, eqAmount: 0.6,
        reverbEnabled: true, reverbAmount: 0.2,
        deEsserEnabled: false, deEsserAmount: 0.3,
        levelEnabled: true,
        silenceTrimEnabled: false, silenceTrimMode: 'compress', silenceTrimSensitivity: 0.5,
        hissEnabled: true, hissAmount: 0.4
      }
    },
    podcast: {
      name: 'Podcast',
      icon: '🎙️',
      desc: 'Room echo & clarity',
      settings: {
        noiseEnabled: true, noiseAmount: 0.7, noiseThreshold: 0.5, noiseCalibrate: 0.0, manualNoiseProfile: null,
        eqEnabled: true, eqAmount: 0.5,
        reverbEnabled: true, reverbAmount: 0.8,
        deEsserEnabled: true, deEsserAmount: 0.6,
        levelEnabled: true,
        silenceTrimEnabled: true, silenceTrimMode: 'compress', silenceTrimSensitivity: 0.5,
        hissEnabled: false, hissAmount: 0.0
      }
    },
    voiceover: {
      name: 'Voiceover',
      icon: '🎤',
      desc: 'Broadcast-ready voice',
      settings: {
        noiseEnabled: true, noiseAmount: 0.8, noiseThreshold: 0.5, noiseCalibrate: 0.0, manualNoiseProfile: null,
        eqEnabled: true, eqAmount: 0.7,
        reverbEnabled: true, reverbAmount: 0.6,
        deEsserEnabled: true, deEsserAmount: 0.5,
        levelEnabled: true,
        silenceTrimEnabled: true, silenceTrimMode: 'remove', silenceTrimSensitivity: 0.5,
        hissEnabled: false, hissAmount: 0.0
      }
    },
    music: {
      name: 'Music',
      icon: '🎵',
      desc: 'Gentle cleanup',
      settings: {
        noiseEnabled: true, noiseAmount: 0.4, noiseThreshold: 0.3, noiseCalibrate: 0.0, manualNoiseProfile: null,
        eqEnabled: true, eqAmount: 0.3,
        reverbEnabled: true, reverbAmount: 0.2,
        deEsserEnabled: false, deEsserAmount: 0.3,
        levelEnabled: false,
        silenceTrimEnabled: false, silenceTrimMode: 'compress', silenceTrimSensitivity: 0.3,
        hissEnabled: false, hissAmount: 0.0
      }
    }
  };

  let activePreset = 'custom';

  /**
   * Initialize audio context
   */
  function init() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }

  /**
   * Decode an audio file into an AudioBuffer
   */
  async function decodeFile(file) {
    init();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    originalBuffer = audioBuffer;
    return audioBuffer;
  }

  /**
   * Apply low-cut (high-pass) filter at 100Hz to eliminate low-frequency rumble
   */
  async function applyLowCut(buffer) {
    const { numberOfChannels, sampleRate, length } = buffer;
    const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 100;
    highpass.Q.value = 0.707; // Butterworth filter response

    source.connect(highpass).connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering();
  }

  /**
   * Run the full processing pipeline
   * Order: Low-Cut → Noise Gate → De-Reverb → EQ → De-Esser → Auto-Level → Silence Trim
   */
  async function processAudio(onProgress) {
    if (!originalBuffer) throw new Error('No audio loaded');
    init();

    // Apply low-cut filter at the very start of the processing chain
    if (onProgress) onProgress(0, 'Applying 100Hz Low-Cut...');
    let buffer = await applyLowCut(originalBuffer);

    const steps = [];
    if (settings.noiseEnabled) steps.push('noise');
    if (settings.hissEnabled) steps.push('hiss');
    if (settings.reverbEnabled) steps.push('reverb');
    if (settings.eqEnabled) steps.push('eq');
    if (settings.deEsserEnabled) steps.push('deesser');
    if (settings.levelEnabled) steps.push('level');
    if (settings.silenceTrimEnabled) steps.push('silence');

    const totalSteps = steps.length;
    let currentStep = 0;

    for (const step of steps) {
      const stepName = getStepName(step);
      if (onProgress) onProgress((currentStep / totalSteps) * 100, `Applying ${stepName}...`);
      await new Promise(r => setTimeout(r, 30));

      switch (step) {
        case 'noise':
          buffer = NoiseReduction.applyNoiseGate(
            buffer, 
            settings.noiseAmount, 
            settings.noiseThreshold, 
            settings.manualNoiseProfile, 
            settings.noiseCalibrate
          );
          break;
        case 'hiss':
          buffer = await applyHissReductionOffline(buffer, settings.hissAmount);
          break;
        case 'reverb':
          buffer = NoiseReduction.applyDeReverb(buffer, settings.reverbAmount);
          break;
        case 'eq':
          buffer = await applyStudioEQ(buffer, settings.eqAmount);
          break;
        case 'deesser':
          buffer = DeEsser.apply(buffer, settings.deEsserAmount);
          break;
        case 'level':
          buffer = applyAutoLevel(buffer);
          break;
        case 'silence':
          buffer = SilenceTrimmer.apply(buffer, {
            mode: settings.silenceTrimMode,
            sensitivity: settings.silenceTrimSensitivity
          });
          break;
      }

      currentStep++;
      if (onProgress) {
        const nextName = currentStep < totalSteps ? getStepName(steps[currentStep]) : null;
        onProgress(
          (currentStep / totalSteps) * 100,
          currentStep === totalSteps ? 'Done!' : `Applying ${nextName}...`
        );
      }
    }

    cleanedBuffer = buffer;
    return buffer;
  }

  function getStepName(step) {
    return {
      noise: 'Noise Removal',
      hiss: 'Hiss Reduction',
      reverb: 'De-Reverb',
      eq: 'Studio Magic EQ',
      deesser: 'De-Esser',
      level: 'Auto-Leveling',
      silence: 'Silence Trimmer'
    }[step] || step;
  }

  /**
   * Apply Studio Magic EQ
   */
  async function applyStudioEQ(buffer, amount) {
    const { numberOfChannels, sampleRate, length } = buffer;
    const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const scale = amount;

    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass'; highpass.frequency.value = 80; highpass.Q.value = 0.7;

    const lowShelf = offlineCtx.createBiquadFilter();
    lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 250; lowShelf.gain.value = 2.5 * scale;

    const lowMidCut = offlineCtx.createBiquadFilter();
    lowMidCut.type = 'peaking'; lowMidCut.frequency.value = 400; lowMidCut.Q.value = 1.5; lowMidCut.gain.value = -2 * scale;

    const presence = offlineCtx.createBiquadFilter();
    presence.type = 'peaking'; presence.frequency.value = 3000; presence.Q.value = 1.2; presence.gain.value = 3 * scale;

    const highShelf = offlineCtx.createBiquadFilter();
    highShelf.type = 'highshelf'; highShelf.frequency.value = 10000; highShelf.gain.value = 2 * scale;

    source.connect(highpass).connect(lowShelf).connect(lowMidCut).connect(presence).connect(highShelf).connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering();
  }

  /**
   * Apply lowpass filter stage for Hiss Reduction above 8kHz
   */
  async function applyHissReductionOffline(buffer, amount) {
    const { numberOfChannels, sampleRate, length } = buffer;
    const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    const cutoff = 20000 - (12000 * amount); // 20kHz down to 8kHz
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.707;

    source.connect(filter).connect(offlineCtx.destination);
    source.start(0);
    return offlineCtx.startRendering();
  }

  /**
   * Apply auto-leveling
   */
  function applyAutoLevel(buffer) {
    const { numberOfChannels, sampleRate, length } = buffer;
    const ctx = new OfflineAudioContext(numberOfChannels, length, sampleRate);
    const outputBuffer = ctx.createBuffer(numberOfChannels, length, sampleRate);

    for (let ch = 0; ch < numberOfChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = outputBuffer.getChannelData(ch);

      const attack = Math.exp(-1 / (sampleRate * 0.01));
      const release = Math.exp(-1 / (sampleRate * 0.1));
      const threshold = 0.15;
      const ratio = 4;
      const makeupGain = 1.8;
      let envelope = 0;

      for (let i = 0; i < input.length; i++) {
        const absVal = Math.abs(input[i]);
        envelope = absVal > envelope
          ? attack * envelope + (1 - attack) * absVal
          : release * envelope + (1 - release) * absVal;

        let gain = 1;
        if (envelope > threshold) {
          gain = (threshold * Math.pow(envelope / threshold, 1 / ratio)) / (envelope + 1e-10);
        }
        output[i] = input[i] * gain * makeupGain;
      }

      for (let i = 0; i < output.length; i++) output[i] = Math.tanh(output[i]);
    }

    // Peak normalize to -1dB
    let peak = 0;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const d = outputBuffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak > 0.001) {
      const g = 0.89 / peak;
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const d = outputBuffer.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= g;
      }
    }

    return outputBuffer;
  }

  function copyBuffer(buffer) {
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const copy = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      copy.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    return copy;
  }

  // ---- Playback ----

  function play(onEnded) {
    if (isPlaying) return;
    init();
    if (audioContext.state === 'suspended') audioContext.resume();

    const buffer = isShowingCleaned ? cleanedBuffer : originalBuffer;
    if (!buffer) return;

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = buffer;

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    gainNode = audioContext.createGain();
    gainNode.gain.value = 1;

    sourceNode.connect(analyserNode).connect(gainNode).connect(audioContext.destination);

    sourceNode.onended = () => {
      if (isPlaying) { isPlaying = false; pauseOffset = 0; if (onEnded) onEnded(); }
    };

    sourceNode.start(0, pauseOffset);
    startTime = audioContext.currentTime - pauseOffset;
    isPlaying = true;
  }

  function pause() {
    if (!isPlaying || !sourceNode) return;
    pauseOffset = audioContext.currentTime - startTime;
    sourceNode.onended = null;
    sourceNode.stop();
    sourceNode.disconnect();
    sourceNode = null;
    isPlaying = false;
  }

  function stop() { pause(); pauseOffset = 0; }

  function seek(position, onEnded) {
    const buffer = isShowingCleaned ? cleanedBuffer : originalBuffer;
    if (!buffer) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) { sourceNode.onended = null; sourceNode.stop(); sourceNode.disconnect(); sourceNode = null; isPlaying = false; }
    pauseOffset = position * buffer.duration;
    if (wasPlaying) play(onEnded);
  }

  function toggleVersion(onEnded) {
    isShowingCleaned = !isShowingCleaned;
    const wasPlaying = isPlaying;
    if (wasPlaying) {
      const off = audioContext.currentTime - startTime;
      pause();
      pauseOffset = off;
      play(onEnded);
    }
    return isShowingCleaned;
  }

  function getCurrentTime() {
    return isPlaying && audioContext ? audioContext.currentTime - startTime : pauseOffset;
  }

  function getDuration() {
    const b = isShowingCleaned ? cleanedBuffer : originalBuffer;
    return b ? b.duration : 0;
  }

  // ---- Presets ----

  function applyPreset(presetKey) {
    if (!PRESETS[presetKey]) return;
    activePreset = presetKey;
    if (presetKey !== 'custom' && PRESETS[presetKey].settings) {
      Object.assign(settings, PRESETS[presetKey].settings);
    }
    return settings;
  }

  function getPresets() { return PRESETS; }
  function getActivePreset() { return activePreset; }

  // ---- Getters / Setters ----

  function updateSetting(key, value) {
    settings[key] = value;
    activePreset = 'custom';
  }

  function getSettings() { return { ...settings }; }
  function getAnalyser() { return analyserNode; }
  function getOriginalBuffer() { return originalBuffer; }
  function getCleanedBuffer() { return cleanedBuffer; }
  function getIsPlaying() { return isPlaying; }
  function getIsShowingCleaned() { return isShowingCleaned; }

  return {
    init, decodeFile, processAudio,
    play, pause, stop, seek, toggleVersion,
    getCurrentTime, getDuration,
    getAnalyser, getOriginalBuffer, getCleanedBuffer,
    updateSetting, getSettings, getIsPlaying, getIsShowingCleaned,
    applyPreset, getPresets, getActivePreset,
    copyBuffer
  };
})();
