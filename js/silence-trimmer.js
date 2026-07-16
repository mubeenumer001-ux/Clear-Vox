/**
 * silence-trimmer.js
 * Detects and removes/compresses silent segments (dead air, breaths, pauses)
 */

const SilenceTrimmer = (() => {

  /**
   * Apply silence trimming to an AudioBuffer
   * @param {AudioBuffer} buffer - Input audio
   * @param {object} options
   * @param {string} options.mode - 'compress' or 'remove'
   * @param {number} options.sensitivity - 0-1 (higher = more aggressive)
   * @param {number} options.minSilenceDuration - Min silence length in seconds to detect
   * @param {number} options.compressedGap - Gap duration after compression (seconds)
   * @returns {AudioBuffer}
   */
  function apply(buffer, options = {}) {
    const {
      mode = 'compress',
      sensitivity = 0.5,
      minSilenceDuration = 0.6,
      compressedGap = 0.15
    } = options;

    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;

    // Get mono mix for analysis
    const monoData = getMono(buffer);

    // Detect silent regions
    const silentRegions = detectSilence(monoData, sampleRate, sensitivity, minSilenceDuration);

    if (silentRegions.length === 0) {
      return buffer; // Nothing to trim
    }

    if (mode === 'remove') {
      return removeSilence(buffer, silentRegions);
    } else {
      return compressSilence(buffer, silentRegions, compressedGap, sampleRate);
    }
  }

  /**
   * Get mono mix from buffer for analysis
   */
  function getMono(buffer) {
    const ch0 = buffer.getChannelData(0);
    if (buffer.numberOfChannels === 1) return ch0;

    const ch1 = buffer.getChannelData(1);
    const mono = new Float32Array(ch0.length);
    for (let i = 0; i < mono.length; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
    return mono;
  }

  /**
   * Detect silent regions in the audio
   * Returns array of { start, end } sample indices
   */
  function detectSilence(data, sampleRate, sensitivity, minDuration) {
    const blockSize = Math.floor(sampleRate * 0.02); // 20ms analysis blocks
    const minSilenceSamples = Math.floor(minDuration * sampleRate);

    // Compute RMS threshold based on sensitivity
    // Higher sensitivity = higher threshold = more silence detected
    const globalRms = computeRMS(data, 0, data.length);
    const thresholdMultiplier = 0.05 + (1 - sensitivity) * 0.2; // 0.05 to 0.25 of global RMS
    const rmsThreshold = globalRms * thresholdMultiplier;

    const silentRegions = [];
    let silenceStart = -1;

    for (let i = 0; i < data.length; i += blockSize) {
      const end = Math.min(i + blockSize, data.length);
      const blockRms = computeRMS(data, i, end);

      if (blockRms < rmsThreshold) {
        if (silenceStart === -1) silenceStart = i;
      } else {
        if (silenceStart !== -1) {
          const silenceDuration = i - silenceStart;
          if (silenceDuration >= minSilenceSamples) {
            // Add some padding to preserve natural attack
            const padSamples = Math.floor(sampleRate * 0.03); // 30ms pad
            silentRegions.push({
              start: silenceStart + padSamples,
              end: Math.max(silenceStart + padSamples, i - padSamples)
            });
          }
          silenceStart = -1;
        }
      }
    }

    // Handle trailing silence
    if (silenceStart !== -1) {
      const silenceDuration = data.length - silenceStart;
      if (silenceDuration >= minSilenceSamples) {
        const padSamples = Math.floor(sampleRate * 0.03);
        silentRegions.push({
          start: silenceStart + padSamples,
          end: data.length
        });
      }
    }

    return silentRegions;
  }

  /**
   * Compute RMS of a data segment
   */
  function computeRMS(data, start, end) {
    let sum = 0;
    const len = end - start;
    if (len <= 0) return 0;
    for (let i = start; i < end; i++) {
      sum += data[i] * data[i];
    }
    return Math.sqrt(sum / len);
  }

  /**
   * Remove silent regions entirely
   */
  function removeSilence(buffer, regions) {
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;

    // Calculate new length
    let totalRemoved = 0;
    for (const region of regions) {
      totalRemoved += region.end - region.start;
    }

    const newLength = buffer.length - totalRemoved;
    if (newLength <= 0) return buffer;

    const ctx = new OfflineAudioContext(numChannels, newLength, sampleRate);
    const outputBuffer = ctx.createBuffer(numChannels, newLength, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = outputBuffer.getChannelData(ch);

      let writePos = 0;
      let readPos = 0;

      for (const region of regions) {
        // Copy audio before this silent region
        const copyLen = region.start - readPos;
        if (copyLen > 0) {
          output.set(input.subarray(readPos, region.start), writePos);
          writePos += copyLen;
        }
        readPos = region.end;
      }

      // Copy remaining audio after last region
      if (readPos < input.length) {
        output.set(input.subarray(readPos), writePos);
      }
    }

    return outputBuffer;
  }

  /**
   * Compress silent regions to a short gap with crossfade
   */
  function compressSilence(buffer, regions, gapDuration, sampleRate) {
    const numChannels = buffer.numberOfChannels;
    const gapSamples = Math.floor(gapDuration * sampleRate);
    const fadeSamples = Math.floor(sampleRate * 0.01); // 10ms crossfade

    // Calculate new length
    let totalRemoved = 0;
    for (const region of regions) {
      const regionLen = region.end - region.start;
      totalRemoved += Math.max(0, regionLen - gapSamples);
    }

    const newLength = buffer.length - totalRemoved;
    if (newLength <= 0) return buffer;

    const ctx = new OfflineAudioContext(numChannels, newLength, sampleRate);
    const outputBuffer = ctx.createBuffer(numChannels, newLength, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const input = buffer.getChannelData(ch);
      const output = outputBuffer.getChannelData(ch);

      let writePos = 0;
      let readPos = 0;

      for (const region of regions) {
        // Copy audio before silent region
        const copyLen = region.start - readPos;
        if (copyLen > 0) {
          output.set(input.subarray(readPos, region.start), writePos);
          writePos += copyLen;
        }

        // Insert compressed gap (silence)
        const actualGap = Math.min(gapSamples, region.end - region.start);
        for (let i = 0; i < actualGap; i++) {
          if (writePos + i < output.length) {
            // Fade out at start, fade in at end
            let gain = 0;
            if (i < fadeSamples) {
              gain = 1 - (i / fadeSamples);
            } else if (i > actualGap - fadeSamples) {
              gain = (i - (actualGap - fadeSamples)) / fadeSamples;
            }
            const srcIdx = region.start + i;
            output[writePos + i] = srcIdx < input.length ? input[srcIdx] * gain : 0;
          }
        }
        writePos += actualGap;
        readPos = region.end;
      }

      // Copy remaining
      if (readPos < input.length) {
        const remaining = input.length - readPos;
        const toCopy = Math.min(remaining, output.length - writePos);
        if (toCopy > 0) {
          output.set(input.subarray(readPos, readPos + toCopy), writePos);
        }
      }
    }

    return outputBuffer;
  }

  /**
   * Get info about detected silence (for UI display)
   */
  function analyze(buffer, sensitivity = 0.5, minDuration = 0.6) {
    const mono = getMono(buffer);
    const regions = detectSilence(mono, buffer.sampleRate, sensitivity, minDuration);

    let totalSilence = 0;
    for (const r of regions) {
      totalSilence += (r.end - r.start) / buffer.sampleRate;
    }

    return {
      count: regions.length,
      totalSeconds: totalSilence,
      percentage: (totalSilence / buffer.duration) * 100
    };
  }

  return { apply, analyze };
})();
