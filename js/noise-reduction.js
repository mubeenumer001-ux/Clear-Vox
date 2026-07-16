/**
 * noise-reduction.js
 * Spectral gating noise reduction & de-reverb using Web Audio API
 * Processes audio offline in the frequency domain
 */

const NoiseReduction = (() => {
  /**
   * Applies spectral gating noise reduction to an AudioBuffer
   * @param {AudioBuffer} audioBuffer - The input audio buffer
   * @param {number} strength - Noise reduction strength (0-1)
   * @param {BaseAudioContext} ctx - Audio context for creating buffers
   * @returns {AudioBuffer} - Processed audio buffer
   */
  function applyNoiseGate(audioBuffer, strength = 0.7) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    // Create output buffer
    const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
    const outputBuffer = offlineCtx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const inputData = audioBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      processChannelNoiseReduction(inputData, outputData, strength, sampleRate);
    }

    return outputBuffer;
  }

  /**
   * Process a single channel for noise reduction using spectral gating
   */
  function processChannelNoiseReduction(input, output, strength, sampleRate) {
    const fftSize = 2048;
    const hopSize = fftSize / 4;
    const numFrames = Math.floor((input.length - fftSize) / hopSize) + 1;

    // Create window function (Hann)
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Estimate noise profile from first 0.5 seconds (assumed to be noise)
    const noiseFrames = Math.min(Math.ceil((sampleRate * 0.5) / hopSize), numFrames);
    const noiseProfile = new Float32Array(fftSize / 2 + 1);

    // Accumulate noise spectrum
    for (let frame = 0; frame < noiseFrames; frame++) {
      const offset = frame * hopSize;
      const spectrum = computeMagnitudeSpectrum(input, offset, fftSize, window);
      for (let i = 0; i < spectrum.length; i++) {
        noiseProfile[i] += spectrum[i] / noiseFrames;
      }
    }

    // Scale noise threshold by strength
    const threshold = new Float32Array(noiseProfile.length);
    for (let i = 0; i < threshold.length; i++) {
      threshold[i] = noiseProfile[i] * (1 + strength * 3);
    }

    // Initialize output to zero
    output.fill(0);
    const windowSum = new Float32Array(input.length);

    // Process each frame
    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * hopSize;

      // Extract and window the frame
      const frameData = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        if (offset + i < input.length) {
          frameData[i] = input[offset + i] * window[i];
        }
      }

      // FFT
      const { real, imag } = fft(frameData);

      // Spectral gating
      for (let i = 0; i <= fftSize / 2; i++) {
        const magnitude = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);

        if (magnitude < threshold[i]) {
          // Below noise floor — attenuate
          const gain = Math.max(0, 1 - (threshold[i] / (magnitude + 1e-10)) * strength);
          real[i] *= gain;
          imag[i] *= gain;

          // Mirror for negative frequencies
          if (i > 0 && i < fftSize / 2) {
            real[fftSize - i] *= gain;
            imag[fftSize - i] *= gain;
          }
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
  function applyDeReverb(audioBuffer, strength = 0.5) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);
    const outputBuffer = offlineCtx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const inputData = audioBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);

      processChannelDeReverb(inputData, outputData, strength, sampleRate);
    }

    return outputBuffer;
  }

  /**
   * Process a single channel for de-reverb
   * Uses spectral decay analysis to identify and reduce reverb tails
   */
  function processChannelDeReverb(input, output, strength, sampleRate) {
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
        cleanMag = Math.max(cleanMag, magnitude * 0.1); // Floor to avoid artifacts

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
    applyDeReverb
  };
})();
