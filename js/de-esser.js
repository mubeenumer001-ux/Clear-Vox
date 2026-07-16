/**
 * de-esser.js
 * Dynamic sibilance control — reduces harsh "S", "Sh", "T" sounds
 * Uses frequency-band energy detection + dynamic gain reduction
 */

const DeEsser = (() => {

  /**
   * Apply de-essing to an AudioBuffer
   * @param {AudioBuffer} buffer - Input audio
   * @param {number} intensity - De-essing intensity (0-1)
   * @returns {AudioBuffer} - Processed audio
   */
  function apply(buffer, intensity = 0.5) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const ctx = new OfflineAudioContext(numChannels, length, sampleRate);
    const outputBuffer = ctx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = outputBuffer.getChannelData(ch);
      processChannel(input, output, intensity, sampleRate);
    }

    return outputBuffer;
  }

  /**
   * Process a single channel for de-essing
   * Detects sibilant energy in 4kHz-9kHz band and applies dynamic attenuation
   */
  function processChannel(input, output, intensity, sampleRate) {
    const fftSize = 2048;
    const hopSize = fftSize / 4;
    const numFrames = Math.floor((input.length - fftSize) / hopSize) + 1;

    // Hann window
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Sibilance frequency range in bins
    const binResolution = sampleRate / fftSize;
    const lowBin = Math.floor(4000 / binResolution);
    const highBin = Math.min(Math.ceil(9000 / binResolution), fftSize / 2);

    // Threshold: energy level above which we consider sibilance
    // Lower threshold = more aggressive de-essing
    const threshold = 0.02 * (1 - intensity * 0.8);
    const ratio = 2 + intensity * 4; // Compression ratio for sibilant band
    const maxReduction = 0.3 + (1 - intensity) * 0.5; // Minimum gain floor

    output.set(input); // Start with copy
    const windowSum = new Float32Array(input.length);
    const processedOut = new Float32Array(input.length);

    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * hopSize;

      // Window the frame
      const frameData = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        if (offset + i < input.length) {
          frameData[i] = input[offset + i] * window[i];
        }
      }

      // Compute FFT
      const { real, imag } = fft(frameData);

      // Measure sibilant band energy
      let sibilantEnergy = 0;
      let totalEnergy = 0;

      for (let i = 0; i <= fftSize / 2; i++) {
        const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
        totalEnergy += mag;
        if (i >= lowBin && i <= highBin) {
          sibilantEnergy += mag;
        }
      }

      // Compute sibilance ratio
      const sibilanceRatio = totalEnergy > 0 ? sibilantEnergy / totalEnergy : 0;

      // If sibilance detected, attenuate the sibilant band
      if (sibilanceRatio > threshold) {
        const overshoot = sibilanceRatio / threshold;
        const gainReduction = Math.max(maxReduction, 1 / Math.pow(overshoot, 1 / ratio));

        for (let i = lowBin; i <= highBin; i++) {
          // Smooth the gain across the band edges (fade in/out)
          let bandGain = gainReduction;
          const edgeWidth = 4;

          if (i < lowBin + edgeWidth) {
            const t = (i - lowBin) / edgeWidth;
            bandGain = 1 - t * (1 - gainReduction);
          } else if (i > highBin - edgeWidth) {
            const t = (highBin - i) / edgeWidth;
            bandGain = 1 - t * (1 - gainReduction);
          }

          real[i] *= bandGain;
          imag[i] *= bandGain;

          // Mirror
          if (i > 0 && i < fftSize / 2) {
            real[fftSize - i] *= bandGain;
            imag[fftSize - i] *= bandGain;
          }
        }
      }

      // IFFT
      const processed = ifft(real, imag);

      // Overlap-add
      for (let i = 0; i < fftSize; i++) {
        if (offset + i < processedOut.length) {
          processedOut[offset + i] += processed[i] * window[i];
          windowSum[offset + i] += window[i] * window[i];
        }
      }
    }

    // Normalize
    for (let i = 0; i < output.length; i++) {
      if (windowSum[i] > 1e-8) {
        output[i] = processedOut[i] / windowSum[i];
      }
    }
  }

  // ---- FFT (shared with noise-reduction.js but self-contained here) ----

  function fft(signal) {
    const n = signal.length;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    const bits = Math.log2(n);

    for (let i = 0; i < n; i++) {
      real[bitReverse(i, bits)] = signal[i];
    }

    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = -2 * Math.PI / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const angle = step * j;
          const tR = Math.cos(angle) * real[i + j + half] - Math.sin(angle) * imag[i + j + half];
          const tI = Math.cos(angle) * imag[i + j + half] + Math.sin(angle) * real[i + j + half];
          real[i + j + half] = real[i + j] - tR;
          imag[i + j + half] = imag[i + j] - tI;
          real[i + j] += tR;
          imag[i + j] += tI;
        }
      }
    }
    return { real, imag };
  }

  function ifft(real, imag) {
    const n = real.length;
    const bits = Math.log2(n);
    const conjImag = new Float32Array(n);
    for (let i = 0; i < n; i++) conjImag[i] = -imag[i];

    const rOut = new Float32Array(n);
    const iOut = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const rev = bitReverse(i, bits);
      rOut[rev] = real[i];
      iOut[rev] = conjImag[i];
    }

    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = -2 * Math.PI / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < half; j++) {
          const angle = step * j;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          const tR = cos * rOut[i + j + half] - sin * iOut[i + j + half];
          const tI = cos * iOut[i + j + half] + sin * rOut[i + j + half];
          rOut[i + j + half] = rOut[i + j] - tR;
          iOut[i + j + half] = iOut[i + j] - tI;
          rOut[i + j] += tR;
          iOut[i + j] += tI;
        }
      }
    }

    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) result[i] = rOut[i] / n;
    return result;
  }

  function bitReverse(x, bits) {
    let r = 0;
    for (let i = 0; i < bits; i++) { r = (r << 1) | (x & 1); x >>= 1; }
    return r;
  }

  return { apply };
})();
