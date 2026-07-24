/**
 * waveform.js
 * Canvas-based waveform and frequency visualizer
 */

const WaveformVisualizer = (() => {
  let waveformCanvas, waveformCtx;
  let freqCanvas, freqCtx;
  let animationId = null;

  // Colors
  const colors = {
    originalWave: 'rgba(100, 116, 139, 0.35)',
    cleanedWave: createGradientColors(),
    freqBar: null, // set after canvas init
    cursorColor: '#06B6D4',
    bgDark: 'rgba(0, 0, 0, 0.0)'
  };

  function createGradientColors() {
    return ['#7C3AED', '#a855f7', '#06B6D4'];
  }

  /**
   * Initialize canvases
   */
  function init() {
    waveformCanvas = document.getElementById('waveform-canvas');
    freqCanvas = document.getElementById('freq-canvas');

    if (waveformCanvas) {
      waveformCtx = waveformCanvas.getContext('2d');
      resizeCanvas(waveformCanvas);
    }

    if (freqCanvas) {
      freqCtx = freqCanvas.getContext('2d');
      resizeCanvas(freqCanvas);
    }

    window.addEventListener('resize', () => {
      if (waveformCanvas) resizeCanvas(waveformCanvas);
      if (freqCanvas) resizeCanvas(freqCanvas);
    });
  }

  function resizeCanvas(canvas) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  /**
   * Draw static waveform from an AudioBuffer
   */
  function drawWaveform(originalBuffer, cleanedBuffer) {
    if (!waveformCanvas || !waveformCtx) return;
    resizeCanvas(waveformCanvas);

    const width = waveformCanvas.parentElement.getBoundingClientRect().width;
    const height = waveformCanvas.parentElement.getBoundingClientRect().height;
    const ctx = waveformCtx;

    ctx.clearRect(0, 0, width, height);

    // Draw original waveform (dimmed)
    if (originalBuffer) {
      drawBufferWaveform(ctx, originalBuffer, width, height, colors.originalWave, false);
    }

    // Draw cleaned waveform (vibrant gradient)
    if (cleanedBuffer) {
      drawBufferWaveform(ctx, cleanedBuffer, width, height, null, true);
    }
  }

  function drawBufferWaveform(ctx, buffer, width, height, color, useGradient) {
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const halfHeight = height / 2;

    ctx.beginPath();

    if (useGradient) {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(124, 58, 237, 0.8)');
      gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.8)');
      gradient.addColorStop(1, 'rgba(6, 182, 212, 0.8)');
      ctx.strokeStyle = gradient;
      ctx.fillStyle = 'transparent';
    } else {
      ctx.strokeStyle = color;
    }

    ctx.lineWidth = 1;

    // Draw bars style waveform
    const barWidth = Math.max(1, (width / (data.length / step)) - 0.5);

    for (let i = 0; i < width; i += barWidth + 0.5) {
      const dataIndex = Math.floor((i / width) * data.length);

      // Get min/max in this chunk
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const val = data[dataIndex + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }

      const yMin = halfHeight + min * halfHeight * 0.9;
      const yMax = halfHeight + max * halfHeight * 0.9;
      const barHeight = Math.max(1, yMin - yMax);

      if (useGradient) {
        const gradient = ctx.createLinearGradient(0, yMax, 0, yMin);
        gradient.addColorStop(0, 'rgba(124, 58, 237, 0.85)');
        gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.7)');
        gradient.addColorStop(1, 'rgba(6, 182, 212, 0.85)');
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = color;
      }

      // Rounded bars
      const radius = Math.min(barWidth / 2, 1);
      roundedRect(ctx, i, yMax, barWidth, barHeight, radius);
      ctx.fill();
    }
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  let fadeAnimId = null;

  /**
   * Start real-time frequency visualizer
   */
  function startFrequencyVisualizer(analyser) {
    if (!freqCanvas || !freqCtx || !analyser) return;

    if (fadeAnimId) {
      cancelAnimationFrame(fadeAnimId);
      fadeAnimId = null;
    }
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    resizeCanvas(freqCanvas);
    freqCtx.globalAlpha = 1.0;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animationId = requestAnimationFrame(draw);

      const parent = freqCanvas.parentElement;
      const width = parent ? parent.getBoundingClientRect().width : freqCanvas.width;
      const height = parent ? parent.getBoundingClientRect().height : freqCanvas.height;
      const ctx = freqCtx;

      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, width, height);

      const isCleaned = (typeof AudioEngine !== 'undefined' && AudioEngine.getIsShowingCleaned)
        ? AudioEngine.getIsShowingCleaned()
        : true;

      // Update badge text if element exists
      const badge = document.getElementById('spectrum-mode-badge');
      if (badge) {
        badge.textContent = isCleaned ? 'CLEANED' : 'ORIGINAL';
        badge.style.background = isCleaned ? 'rgba(6, 182, 212, 0.15)' : 'rgba(148, 163, 184, 0.15)';
        badge.style.color = isCleaned ? 'var(--accent-cyan)' : 'var(--text-secondary)';
      }

      const barCount = 48; // Crisp, highly visible spectrum bars
      const gap = 2; // Exact 2px gap between bars
      const totalGapSpace = (barCount - 1) * gap;
      const barWidth = Math.max(2, (width - totalGapSpace) / barCount);

      // Gradient for Cleaned mode (Cyan fading into deep purple/violet)
      const neonGradient = ctx.createLinearGradient(0, height, 0, 0);
      neonGradient.addColorStop(0, '#06B6D4'); // Bright Cyan
      neonGradient.addColorStop(0.5, '#7C3AED'); // Deep Purple
      neonGradient.addColorStop(1, '#EC4899'); // Neon Pink accent top

      for (let i = 0; i < barCount; i++) {
        const binIndex = Math.floor(Math.pow(i / barCount, 1.25) * bufferLength);
        const value = dataArray[binIndex] || 0;
        const normalizedValue = value / 255;

        const barHeight = Math.max(3, normalizedValue * height * 0.88);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        if (isCleaned) {
          ctx.fillStyle = neonGradient;
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.45)'; // Muted flat gray for Original
        }

        const radius = Math.min(barWidth / 2, 3);
        roundedRect(ctx, x, y, barWidth, barHeight, radius);
        ctx.fill();

        // Soft neon glow effect on high audio levels in Cleaned mode
        if (isCleaned && normalizedValue > 0.35) {
          ctx.shadowColor = 'rgba(6, 182, 212, 0.6)';
          ctx.shadowBlur = 8 * normalizedValue;
          roundedRect(ctx, x, y, barWidth, barHeight, radius);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    draw();
  }

  /**
   * Stop frequency visualizer with a smooth fade-out animation
   */
  function stopFrequencyVisualizer() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    if (fadeAnimId) {
      cancelAnimationFrame(fadeAnimId);
      fadeAnimId = null;
    }

    if (!freqCanvas || !freqCtx) return;

    let opacity = 1.0;
    function fadeOut() {
      if (opacity <= 0.05) {
        const parent = freqCanvas.parentElement;
        const width = parent ? parent.getBoundingClientRect().width : freqCanvas.width;
        const height = parent ? parent.getBoundingClientRect().height : freqCanvas.height;
        freqCtx.clearRect(0, 0, width, height);
        freqCtx.globalAlpha = 1.0;
        fadeAnimId = null;
        return;
      }
      opacity *= 0.78; // Smooth exponential fade-out
      freqCtx.globalAlpha = opacity;
      fadeAnimId = requestAnimationFrame(fadeOut);
    }

    fadeOut();
  }

  /**
   * Update playback cursor position (0-1)
   */
  function updateCursor(position) {
    const cursor = document.getElementById('waveform-cursor');
    if (cursor) {
      cursor.style.left = (position * 100) + '%';
    }
  }

  /**
   * Format time in M:SS
   */
  function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Public API
  return {
    init,
    drawWaveform,
    startFrequencyVisualizer,
    stopFrequencyVisualizer,
    updateCursor,
    formatTime,
    resizeCanvas
  };
})();
