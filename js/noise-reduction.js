/**
 * noise-reduction.js
 * Spectral gating noise reduction & de-reverb using Web Audio API
 * Processes audio offline in the frequency domain
 * Includes Adaptive Noise Estimation (Asymmetric minima tracking filter)
 */

const NoiseReduction = (() => {
  /**
   * Applies spectral gating noise reduction to an AudioBuffer
   * @param {AudioBuffer} audioBuffer - The input audio buffer
   * @param {number} strength - Noise reduction strength / intensity (0-1)
   * @param {number} sensitivity - Threshold sensitivity multiplier (0-1)
   * @returns {AudioBuffer} - Processed audio buffer
   */
  function applyNoiseGate(audioBuffer, strength = 0.7, sensitivity = 0.5, manualNoiseProfile = null, dbShift = 0, bothActive = false, noiseSmoothing = 0.0) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    // Create output buffer
    const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
    const outputBuffer = offlineCtx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const inputData = audioBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      processChannelNoiseReduction(inputData, outputData, strength, sensitivity, sampleRate, manualNoiseProfile, dbShift, bothActive, noiseSmoothing);
    }

    return outputBuffer;
  }

  /**
   * Process a single channel for noise reduction using adaptive spectral gating
   */
  function processChannelNoiseReduction(input, output, strength, sensitivity, sampleRate, manualNoiseProfile = null, dbShift = 0, bothActive = false, noiseSmoothing = 0.0) {
    const fftSize = 2048;
    const hopSize = fftSize / 4;
    const numFrames = Math.floor((input.length - fftSize) / hopSize) + 1;

    // Create window function (Hann)
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Adaptive noise floor tracking
    const noiseFloor = new Float32Array(fftSize / 2 + 1);

    // Prev gains buffer for temporal smoothing
    const prevGains = new Float32Array(fftSize / 2 + 1);
    prevGains.fill(1.0);
    
    // Time constants for asymmetric tracking filter
    const dt = hopSize / sampleRate;
    const tcDown = 0.06; // 60ms decay to adapt to silent intervals quickly
    const tcUp = 9.0;    // 9s attack to prevent speech energy from polluting estimated noise
    const alphaDown = Math.exp(-dt / tcDown);
    const alphaUp = Math.exp(-dt / tcUp);

    // Multiplier for threshold based on sensitivity slider (0 to 1)
    // 0 -> 1.0x, 0.5 -> 2.8x, 1.0 -> 7.0x noise floor
    const thresholdMultiplier = 1.0 + sensitivity * 6.0;
    const gainFloor = Math.max(0.01, 1.0 - strength * 0.98); // Dynamic gain floor based on intensity

    // Initialize output to zero
    output.fill(0);
    const windowSum = new Float32Array(input.length);

    // Temp buffers for frames
    const frameData = new Float32Array(fftSize);
    const magnitudes = new Float32Array(fftSize / 2 + 1);
    const phases = new Float32Array(fftSize / 2 + 1);

    // Initialize noise floor with first frame magnitude or manual profile
    if (manualNoiseProfile) {
      noiseFloor.set(manualNoiseProfile);
    } else {
      const firstSpectrum = computeMagnitudeSpectrum(input, 0, fftSize, window);
      noiseFloor.set(firstSpectrum);
    }

    // Convert dbShift to a linear multiplier factor (dB to amplitude multiplier)
    const shiftMultiplier = Math.pow(10, dbShift / 20);

    // Process each frame
    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * hopSize;

      // Extract and window the frame
      for (let i = 0; i < fftSize; i++) {
        frameData[i] = (offset + i < input.length) ? input[offset + i] * window[i] : 0;
      }

      // FFT
      const { real, imag } = fft(frameData);

      // Compute magnitude, phase, and update adaptive noise floor
      const alpha = 2.0 + strength * 1.5; // Oversubtraction factor (2.0 to 3.5)
      const beta = 0.02; // Strict spectral floor to preserve natural ambient cushion

      for (let i = 0; i <= fftSize / 2; i++) {
        const r = real[i], im = imag[i];
        const mag = Math.sqrt(r * r + im * im);
        magnitudes[i] = mag;
        phases[i] = Math.atan2(im, r);

        // Adaptive asymmetric time-constant filtering (Minima tracking) OR lock to manual noise profile
        if (manualNoiseProfile) {
          noiseFloor[i] = manualNoiseProfile[i];
        } else {
          if (mag < noiseFloor[i]) {
            noiseFloor[i] = alphaDown * noiseFloor[i] + (1 - alphaDown) * mag;
          } else {
            noiseFloor[i] = alphaUp * noiseFloor[i] + (1 - alphaUp) * mag;
          }
        }

        // Apply scaling sensitivity multiplier and calibrate decibel shift
        const noiseEstimate = noiseFloor[i] * thresholdMultiplier * shiftMultiplier;

        // Berouti spectral subtraction
        const magSquared = mag * mag;
        const noiseSquared = noiseEstimate * noiseEstimate;

        let cleanPower = magSquared - alpha * noiseSquared;
        if (cleanPower < beta * noiseSquared) {
          cleanPower = beta * noiseSquared;
        }

        const cleanMag = Math.sqrt(cleanPower);
        let gain = Math.min(1.0, cleanMag / (mag + 1e-10));

        // Temporal spectral smoothing
        if (noiseSmoothing > 0) {
          gain = noiseSmoothing * prevGains[i] + (1 - noiseSmoothing) * gain;
        }
        prevGains[i] = gain;

        // Apply crosstalk gain floor limit
        if (bothActive && gain < 0.316) {
          gain = 0.316;
        }

        real[i] *= gain;
        imag[i] *= gain;

        if (i > 0 && i < fftSize / 2) {
          real[fftSize - i] = real[i];
          imag[fftSize - i] = -imag[i];
        }
      }

      // IFFT
      const processed = ifft(real, imag);

      // Overlap-add with window
      for (let i = 0; i < fftSize; i++) {
        if (offset + i < output.length) {
          output[offset + i] += processed[i] * window[i];
          windowSum[offset + i] += window[i] * window[i];
        }
      }
    }

    // Normalize by window sum
    for (let i = 0; i < output.length; i++) {
      if (windowSum[i] > 1e-8) {
        output[i] /= windowSum[i];
      }
    }
  }

  /**
   * Apply de-reverb (echo reduction) using spectral subtraction
   */
  function applyDeReverb(audioBuffer, strength = 0.5, bothActive = false) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
    const outputBuffer = offlineCtx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const inputData = audioBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      processChannelDeReverb(inputData, outputData, strength, sampleRate, bothActive);
    }

    return outputBuffer;
  }

  /**
   * Process a single channel for de-reverb
   * Uses spectral decay analysis to identify and reduce reverb tails
   */
  function processChannelDeReverb(input, output, strength, sampleRate, bothActive = false) {
    const fftSize = 4096;
    const hopSize = fftSize / 4;
    const numFrames = Math.floor((input.length - fftSize) / hopSize) + 1;

    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Running average of magnitude spectrum (reverb estimation)
    const prevMagnitudes = new Float32Array(fftSize / 2 + 1);
    const smoothingFactor = 0.85;

    output.fill(0);
    const windowSum = new Float32Array(input.length);

    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * hopSize;

      const frameData = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        if (offset + i < input.length) {
          frameData[i] = input[offset + i] * window[i];
        }
      }

      const { real, imag } = fft(frameData);

      // Spectral subtraction for reverb
      for (let i = 0; i <= fftSize / 2; i++) {
        const magnitude = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        const phase = Math.atan2(imag[i], real[i]);

        // Estimate reverb component from temporal smoothing
        const reverbEstimate = prevMagnitudes[i] * smoothingFactor;
        prevMagnitudes[i] = magnitude;

        // Subtract reverb estimate
        let cleanMag = magnitude - reverbEstimate * strength;
        const minDeReverbGain = bothActive ? 0.316 : 0.1;
        cleanMag = Math.max(cleanMag, magnitude * minDeReverbGain); // Floor to avoid artifacts

        real[i] = cleanMag * Math.cos(phase);
        imag[i] = cleanMag * Math.sin(phase);

        if (i > 0 && i < fftSize / 2) {
          real[fftSize - i] = real[i];
          imag[fftSize - i] = -imag[i];
        }
      }

      const processed = ifft(real, imag);

      for (let i = 0; i < fftSize; i++) {
        if (offset + i < output.length) {
          output[offset + i] += processed[i] * window[i];
          windowSum[offset + i] += window[i] * window[i];
        }
      }
    }

    for (let i = 0; i < output.length; i++) {
      if (windowSum[i] > 1e-8) {
        output[i] /= windowSum[i];
      }
    }
  }

  // ---- FFT Utilities ----

  function computeMagnitudeSpectrum(data, offset, fftSize, window) {
    const frame = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      if (offset + i < data.length) {
        frame[i] = data[offset + i] * window[i];
      }
    }
    const { real, imag } = fft(frame);
    const magnitudes = new Float32Array(fftSize / 2 + 1);
    for (let i = 0; i <= fftSize / 2; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return magnitudes;
  }

  /**
   * Cooley-Tukey radix-2 FFT (in-place)
   */
  function fft(signal) {
    const n = signal.length;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      real[bitReverse(i, Math.log2(n))] = signal[i];
    }

    // Butterfly computations
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const angleStep = -2 * Math.PI / size;

      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const angle = angleStep * j;
          const twiddleReal = Math.cos(angle);
          const twiddleImag = Math.sin(angle);

          const evenIdx = i + j;
          const oddIdx = i + j + halfSize;

          const tReal = twiddleReal * real[oddIdx] - twiddleImag * imag[oddIdx];
          const tImag = twiddleReal * imag[oddIdx] + twiddleImag * real[oddIdx];

          real[oddIdx] = real[evenIdx] - tReal;
          imag[oddIdx] = imag[evenIdx] - tImag;
          real[evenIdx] += tReal;
          imag[evenIdx] += tImag;
        }
      }
    }

    return { real, imag };
  }

  /**
   * Inverse FFT
   */
  function ifft(real, imag) {
    const n = real.length;
    // Conjugate
    const conjImag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      conjImag[i] = -imag[i];
    }

    // Forward FFT on conjugated input
    const signal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      signal[bitReverse(i, Math.log2(n))] = real[i];
    }
    const ri = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ri[bitReverse(i, Math.log2(n))] = conjImag[i];
    }

    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const angleStep = -2 * Math.PI / size;

      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const angle = angleStep * j;
          const twR = Math.cos(angle);
          const twI = Math.sin(angle);

          const eIdx = i + j;
          const oIdx = i + j + halfSize;

          const tR = twR * signal[oIdx] - twI * ri[oIdx];
          const tI = twR * ri[oIdx] + twI * signal[oIdx];

          signal[oIdx] = signal[eIdx] - tR;
          ri[oIdx] = ri[eIdx] - tI;
          signal[eIdx] += tR;
          ri[eIdx] += tI;
        }
      }
    }

    // Conjugate and scale
    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = signal[i] / n;
    }

    return result;
  }

  function bitReverse(x, numBits) {
    let result = 0;
    for (let i = 0; i < numBits; i++) {
      result = (result << 1) | (x & 1);
      x >>= 1;
    }
    return result;
  }

  // Public API
  return {
    applyNoiseGate,
    applyDeReverb,
    fft
  };
})();
