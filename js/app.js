/**
 * app.js
 * Main application controller — wires up auth, UI, presets, batch, export, and all modules
 */

(function () {
  'use strict';

  // ---- Auth DOM ----
  const authOverlay = document.getElementById('auth-overlay');
  const appWrapper = document.getElementById('app-wrapper');
  const tabSignin = document.getElementById('tab-signin');
  const tabSignup = document.getElementById('tab-signup');
  const formSignin = document.getElementById('form-signin');
  const formSignup = document.getElementById('form-signup');
  const authError = document.getElementById('auth-error');
  const btnSignout = document.getElementById('btn-signout');
  const navAvatar = document.getElementById('nav-avatar');
  const navUsername = document.getElementById('nav-username');
  const authGoogle = document.getElementById('auth-google');
  const authGithub = document.getElementById('auth-github');

  // ---- App DOM ----
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const processingStatus = document.getElementById('processing-status');
  const processingText = document.getElementById('processing-text');
  const progressBar = document.getElementById('processing-progress-bar');
  const processingLog = document.getElementById('processing-log');
  const waveformPanel = document.getElementById('waveform-panel');
  const waveformContainer = document.getElementById('waveform-container');
  const playerControls = document.getElementById('player-controls');
  const controlsPanel = document.getElementById('controls-panel');
  const freqVisualizer = document.getElementById('freq-visualizer');
  const presetsPanel = document.getElementById('presets-panel');
  const presetsBar = document.getElementById('presets-bar');
  const batchPanel = document.getElementById('batch-panel');
  const batchList = document.getElementById('batch-list');
  const batchStats = document.getElementById('batch-stats');

  const btnPlay = document.getElementById('btn-play');
  const btnToggle = document.getElementById('btn-toggle');
  const btnExport = document.getElementById('btn-export');
  const exportLabel = document.getElementById('export-label');
  const exportDropdown = document.getElementById('export-dropdown');
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');
  const toggleText = document.getElementById('toggle-text');
  const timeCurrent = document.getElementById('time-current');
  const timeDuration = document.getElementById('time-duration');

  // Controls
  const noiseToggle = document.getElementById('noise-toggle');
  const noiseAmount = document.getElementById('noise-amount');
  const noiseValue = document.getElementById('noise-value');
  const eqToggle = document.getElementById('eq-toggle');
  const eqAmount = document.getElementById('eq-amount');
  const eqValue = document.getElementById('eq-value');
  const reverbToggle = document.getElementById('reverb-toggle');
  const reverbAmount = document.getElementById('reverb-amount');
  const reverbValue = document.getElementById('reverb-value');
  const deesserToggle = document.getElementById('deesser-toggle');
  const deesserAmount = document.getElementById('deesser-amount');
  const deesserValue = document.getElementById('deesser-value');
  const levelToggle = document.getElementById('level-toggle');
  const silenceToggle = document.getElementById('silence-toggle');
  const silenceModeToggle = document.getElementById('silence-mode-toggle');

  // State
  let currentFile = null;
  let playbackTimer = null;
  let isProcessing = false;
  let reprocessTimeout = null;
  let selectedExportFormat = 'wav';
  let currentProcessId = 0; // Async cancel group id

  // All processing step definitions for the log
  const ALL_STEPS = [
    { key: 'noise', name: 'Noise Removal', icon: '🔇' },
    { key: 'reverb', name: 'De-Reverb', icon: '🏠' },
    { key: 'eq', name: 'Studio Magic EQ', icon: '🎛️' },
    { key: 'deesser', name: 'De-Esser', icon: '🦷' },
    { key: 'level', name: 'Auto-Leveling', icon: '📊' },
    { key: 'silence', name: 'Silence Trimmer', icon: '✂️' }
  ];

  // ============================================
  // INITIALIZATION
  // ============================================
  function init() {
    WaveformVisualizer.init();
    bindAuthEvents();
    bindAppEvents();
    bindPresetEvents();
    bindExportEvents();
    bindBatchEvents();
    setupFeatureChips();
    setupQuickSettingsSliders();
    checkAuthState();
  }

  function checkAuthState() {
    if (Auth.isAuthenticated()) {
      showApp();
    } else {
      showAuth();
    }
  }

  // ============================================
  // AUTH
  // ============================================
  function bindAuthEvents() {
    tabSignin.addEventListener('click', () => switchAuthTab('signin'));
    tabSignup.addEventListener('click', () => switchAuthTab('signup'));

    formSignin.addEventListener('submit', (e) => {
      e.preventDefault();
      hideAuthError();
      const email = document.getElementById('signin-email').value;
      const password = document.getElementById('signin-password').value;
      const result = Auth.signIn(email, password);
      result.success ? showApp() : showAuthError(result.error);
    });

    formSignup.addEventListener('submit', (e) => {
      e.preventDefault();
      hideAuthError();
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;
      const result = Auth.signUp(name, email, password);
      result.success ? showApp() : showAuthError(result.error);
    });

    authGoogle.addEventListener('click', () => { if (Auth.socialSignIn('google').success) showApp(); });
    authGithub.addEventListener('click', () => { if (Auth.socialSignIn('github').success) showApp(); });

    btnSignout.addEventListener('click', () => {
      Auth.signOut();
      resetApp();
      showAuth();
    });
  }

  function switchAuthTab(tab) {
    hideAuthError();
    tabSignin.classList.toggle('active', tab === 'signin');
    tabSignup.classList.toggle('active', tab === 'signup');
    formSignin.classList.toggle('active', tab === 'signin');
    formSignup.classList.toggle('active', tab === 'signup');
  }

  function showAuthError(msg) { authError.textContent = msg; authError.classList.add('active'); }
  function hideAuthError() { authError.classList.remove('active'); }
  function showAuth() { authOverlay.classList.remove('hidden'); appWrapper.classList.remove('active'); }

  function showApp() {
    authOverlay.classList.add('hidden');
    appWrapper.classList.add('active');
    const session = Auth.getSession();
    if (session) {
      navAvatar.textContent = session.initials || 'U';
      navUsername.textContent = session.name || 'User';
    }
  }

  // ============================================
  // APP EVENTS
  // ============================================
  function bindAppEvents() {
    // Drop zone
    dropZone.addEventListener('click', (e) => {
      if (e.target.closest('.file-remove-btn')) return;
      fileInput.click();
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      handleFiles(files);
    });
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Player
    btnPlay.addEventListener('click', togglePlayback);
    btnToggle.addEventListener('click', toggleBeforeAfter);

    // Waveform seek
    waveformContainer.addEventListener('click', (e) => {
      const rect = waveformContainer.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      AudioEngine.seek(Math.max(0, Math.min(1, pos)), onPlaybackEnded);
      updateTimeDisplay();
    });

    // Controls
    bindControl(noiseToggle, noiseAmount, noiseValue, 'noiseEnabled', 'noiseAmount');

    const noiseThreshold = document.getElementById('noise-threshold');
    const noiseThresholdValue = document.getElementById('noise-threshold-value');
    if (noiseThreshold) {
      noiseThreshold.addEventListener('input', () => {
        if (noiseThresholdValue) noiseThresholdValue.textContent = noiseThreshold.value + '%';
        AudioEngine.updateSetting('noiseThreshold', noiseThreshold.value / 100);
      });
      noiseThreshold.addEventListener('change', scheduleReprocess);
    }

    bindControl(eqToggle, eqAmount, eqValue, 'eqEnabled', 'eqAmount');
    bindControl(reverbToggle, reverbAmount, reverbValue, 'reverbEnabled', 'reverbAmount');
    bindControl(deesserToggle, deesserAmount, deesserValue, 'deEsserEnabled', 'deEsserAmount');

    levelToggle.addEventListener('change', () => {
      AudioEngine.updateSetting('levelEnabled', levelToggle.checked);
      syncChipsFromSettings();
      scheduleReprocess();
    });

    silenceToggle.addEventListener('change', () => {
      AudioEngine.updateSetting('silenceTrimEnabled', silenceToggle.checked);
      syncChipsFromSettings();
      scheduleReprocess();
    });

    // Silence mode toggle
    silenceModeToggle.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        silenceModeToggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AudioEngine.updateSetting('silenceTrimMode', btn.dataset.mode);
        if (silenceToggle.checked) scheduleReprocess();
      });
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space' && currentFile && !isProcessing) { e.preventDefault(); togglePlayback(); }
    });
  }

  /**
   * Helper to bind a toggle+slider control pair
   */
  function bindControl(toggle, slider, valueEl, toggleKey, amountKey) {
    toggle.addEventListener('change', () => {
      AudioEngine.updateSetting(toggleKey, toggle.checked);
      syncChipsFromSettings();
      scheduleReprocess();
    });
    slider.addEventListener('input', () => {
      valueEl.textContent = slider.value + '%';
      AudioEngine.updateSetting(amountKey, slider.value / 100);
    });
    slider.addEventListener('change', scheduleReprocess);
  }

  // ============================================
  // INTERACTIVE FEATURE CHIPS & QUICK SETTINGS
  // ============================================
  function setupFeatureChips() {
    const chipsContainer = document.getElementById('feature-chips-container');
    if (!chipsContainer) return;

    chipsContainer.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const feature = chip.dataset.feature;

        if (feature === 'video') {
          // Special toggle for video Support representation
          chip.classList.toggle('active');
          updateQuickSettingsVisibility();
          return;
        }

        const enabledKey = {
          'noise': 'noiseEnabled',
          'eq': 'eqEnabled',
          'reverb': 'reverbEnabled',
          'deesser': 'deEsserEnabled',
          'level': 'levelEnabled',
          'silence': 'silenceTrimEnabled'
        }[feature];

        const settings = AudioEngine.getSettings();
        const nextState = !settings[enabledKey];

        // Update AudioEngine
        AudioEngine.updateSetting(enabledKey, nextState);

        // Sync with primary sliders checked box
        const toggleEl = document.getElementById({
          'noise': 'noise-toggle',
          'eq': 'eq-toggle',
          'reverb': 'reverb-toggle',
          'deesser': 'deesser-toggle',
          'level': 'level-toggle',
          'silence': 'silence-toggle'
        }[feature]);

        if (toggleEl) toggleEl.checked = nextState;

        syncChipsFromSettings();
        scheduleReprocess();
      });
    });

    syncChipsFromSettings();
  }

  function syncChipsFromSettings() {
    const s = AudioEngine.getSettings();
    const chipsContainer = document.getElementById('feature-chips-container');
    if (!chipsContainer) return;

    const mapping = {
      'noise': s.noiseEnabled,
      'eq': s.eqEnabled,
      'reverb': s.reverbEnabled,
      'deesser': s.deEsserEnabled,
      'level': s.levelEnabled,
      'silence': s.silenceTrimEnabled
    };

    Object.entries(mapping).forEach(([feature, enabled]) => {
      const chip = chipsContainer.querySelector(`.chip[data-feature="${feature}"]`);
      if (chip) {
        chip.classList.toggle('active', enabled);
      }
    });

    updateQuickSettingsVisibility();
  }

  function updateQuickSettingsVisibility() {
    const s = AudioEngine.getSettings();
    const quickPanel = document.getElementById('quick-settings-panel');
    if (!quickPanel) return;

    const features = [
      { key: 'noise', enabled: s.noiseEnabled, elementId: 'quick-ctrl-noise' },
      { key: 'eq', enabled: s.eqEnabled, elementId: 'quick-ctrl-eq' },
      { key: 'reverb', enabled: s.reverbEnabled, elementId: 'quick-ctrl-reverb' },
      { key: 'deesser', enabled: s.deEsserEnabled, elementId: 'quick-ctrl-deesser' },
      { key: 'level', enabled: s.levelEnabled, elementId: 'quick-ctrl-level' },
      { key: 'silence', enabled: s.silenceTrimEnabled, elementId: 'quick-ctrl-silence' },
      { key: 'video', enabled: document.querySelector('.chip[data-feature="video"]')?.classList.contains('active'), elementId: 'quick-ctrl-video' }
    ];

    let anyActive = false;

    features.forEach(f => {
      const el = document.getElementById(f.elementId);
      if (el) {
        if (f.enabled) {
          el.style.display = 'flex';
          anyActive = true;
        } else {
          el.style.display = 'none';
        }
      }
    });

    if (anyActive) {
      quickPanel.style.display = 'block';
    } else {
      quickPanel.style.display = 'none';
    }
  }

  function setupQuickSettingsSliders() {
    // Two-way sync primary and quick-settings sliders
    linkTwoSliders('quick-noise-amount', 'noise-amount', 'quick-noise-value', 'noise-value', 'noiseAmount');
    linkTwoSliders('quick-noise-threshold', 'noise-threshold', 'quick-noise-threshold-value', 'noise-threshold-value', 'noiseThreshold');
    linkTwoSliders('quick-eq-amount', 'eq-amount', 'quick-eq-value', 'eq-value', 'eqAmount');
    linkTwoSliders('quick-reverb-amount', 'reverb-amount', 'quick-reverb-value', 'reverb-value', 'reverbAmount');
    linkTwoSliders('quick-deesser-amount', 'deesser-amount', 'quick-deesser-value', 'deesser-value', 'deEsserAmount');

    // Level settings slider
    const quickLevelAmount = document.getElementById('quick-level-amount');
    const quickLevelValue = document.getElementById('quick-level-value');
    if (quickLevelAmount) {
      quickLevelAmount.addEventListener('input', () => {
        quickLevelValue.textContent = quickLevelAmount.value + '%';
      });
    }

    // Silence sensitivity slider
    const quickSilenceSens = document.getElementById('quick-silence-sensitivity');
    const quickSilenceValue = document.getElementById('quick-silence-value');
    if (quickSilenceSens) {
      quickSilenceSens.addEventListener('input', () => {
        quickSilenceValue.textContent = quickSilenceSens.value + '%';
        AudioEngine.updateSetting('silenceTrimSensitivity', quickSilenceSens.value / 100);
      });
      quickSilenceSens.addEventListener('change', scheduleReprocess);
    }

    // Silence mode toggles in quick panel
    const quickSilenceModeToggle = document.getElementById('quick-silence-mode-toggle');
    if (quickSilenceModeToggle) {
      quickSilenceModeToggle.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          quickSilenceModeToggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
          silenceModeToggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));

          btn.classList.add('active');
          const siblingBtn = silenceModeToggle.querySelector(`.mode-btn[data-mode="${btn.dataset.mode}"]`);
          if (siblingBtn) siblingBtn.classList.add('active');

          AudioEngine.updateSetting('silenceTrimMode', btn.dataset.mode);
          if (AudioEngine.getSettings().silenceTrimEnabled) scheduleReprocess();
        });
      });
    }

    // Video mix slider
    const quickVideoMix = document.getElementById('quick-video-mix');
    const quickVideoValue = document.getElementById('quick-video-value');
    if (quickVideoMix) {
      quickVideoMix.addEventListener('input', () => {
        quickVideoValue.textContent = quickVideoMix.value + '%';
      });
    }
  }

  function linkTwoSliders(id1, id2, valId1, valId2, settingKey) {
    const s1 = document.getElementById(id1);
    const s2 = document.getElementById(id2);
    const v1 = document.getElementById(valId1);
    const v2 = document.getElementById(valId2);

    if (s1 && s2) {
      s1.addEventListener('input', () => {
        s2.value = s1.value;
        v1.textContent = s1.value + '%';
        v2.textContent = s1.value + '%';
        AudioEngine.updateSetting(settingKey, s1.value / 100);
      });
      s1.addEventListener('change', scheduleReprocess);

      s2.addEventListener('input', () => {
        s1.value = s2.value;
        v1.textContent = s2.value + '%';
        v2.textContent = s2.value + '%';
        AudioEngine.updateSetting(settingKey, s2.value / 100);
      });
      s2.addEventListener('change', scheduleReprocess);
    }
  }

  // ============================================
  // FILE HANDLING
  // ============================================
  function handleFiles(files) {
    if (!files || files.length === 0) return;

    if (files.length === 1) {
      // Single file — standard flow
      handleSingleFile(files[0]);
    } else {
      // Multiple files — batch mode
      handleBatchFiles(files);
    }
  }

  async function handleSingleFile(file) {
    currentFile = file;
    const myProcessId = ++currentProcessId;

    AudioEngine.stop();
    WaveformVisualizer.stopFrequencyVisualizer();
    stopPlaybackTimer();
    showFileInfo(file);
    showProcessingWithLog();

    try {
      // Decoding step
      updateProcessingLog('decode', 'active');
      processingText.textContent = 'Decoding audio...';
      progressBar.style.width = '5%';

      if (VideoProcessor.isVideoFile(file)) {
        // Video: extract audio first
        updateProcessingLog('decode', 'active', 'Extracting audio from video...');
        const audioFile = await VideoProcessor.extractAudio(file, (text) => {
          if (myProcessId !== currentProcessId) return;
          processingText.textContent = text;
        });
        if (myProcessId !== currentProcessId) return;
        await AudioEngine.decodeFile(audioFile);
      } else {
        await AudioEngine.decodeFile(file);
      }

      if (myProcessId !== currentProcessId) return;
      updateProcessingLog('decode', 'done');

      // Sync settings from UI
      syncSettingsFromUI();

      // Process with step-by-step log
      if (myProcessId !== currentProcessId) return;
      await processWithLog(myProcessId);

      if (myProcessId !== currentProcessId) return;
      progressBar.style.width = '100%';
      processingText.textContent = 'All done! ✨';
      await sleep(500);

      if (myProcessId !== currentProcessId) return;
      hideProcessing();
      showPlayerUI();

    } catch (err) {
      if (myProcessId !== currentProcessId) return;
      console.error('Processing error:', err);
      processingText.textContent = 'Error: ' + (err.message || 'Could not process this file');
      progressBar.style.width = '0%';
    }
  }

  /**
   * Process audio with step-by-step log feedback
   */
  async function processWithLog(myProcessId) {
    const s = AudioEngine.getSettings();

    // Build step list
    const enabledSteps = [];
    for (const step of ALL_STEPS) {
      const isEnabled = getStepEnabled(step.key, s);
      if (isEnabled) enabledSteps.push(step);
    }

    // Show all steps in log
    for (const step of ALL_STEPS) {
      const isEnabled = getStepEnabled(step.key, s);
      if (isEnabled) {
        updateProcessingLog(step.key, 'pending');
      } else {
        updateProcessingLog(step.key, 'skipped');
      }
    }

    // Process
    let completedSteps = 0;
    const totalSteps = enabledSteps.length;

    await AudioEngine.processAudio((progress, text) => {
      if (myProcessId !== currentProcessId) return;
      progressBar.style.width = (10 + progress * 0.85) + '%';

      // Determine which step is active based on progress
      const stepIndex = Math.min(Math.floor((progress / 100) * totalSteps), totalSteps - 1);

      // Update log
      for (let i = 0; i < enabledSteps.length; i++) {
        if (i < stepIndex) {
          updateProcessingLog(enabledSteps[i].key, 'done');
        } else if (i === stepIndex) {
          updateProcessingLog(enabledSteps[i].key, 'active');
          processingText.textContent = `Applying ${enabledSteps[i].name}...`;
        }
      }

      // Mark completed
      if (progress >= 100) {
        for (const step of enabledSteps) {
          updateProcessingLog(step.key, 'done');
        }
      }
    });

    if (myProcessId !== currentProcessId) return;

    // Mark all done
    for (const step of enabledSteps) {
      updateProcessingLog(step.key, 'done');
    }
  }

  function getStepEnabled(key, s) {
    switch (key) {
      case 'noise': return s.noiseEnabled;
      case 'reverb': return s.reverbEnabled;
      case 'eq': return s.eqEnabled;
      case 'deesser': return s.deEsserEnabled;
      case 'level': return s.levelEnabled;
      case 'silence': return s.silenceTrimEnabled;
      default: return false;
    }
  }

  function showFileInfo(file) {
    const size = file.size < 1024 * 1024
      ? (file.size / 1024).toFixed(1) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';

    const isVideo = VideoProcessor.isVideoFile(file);

    dropZone.classList.add('has-file');
    dropZone.innerHTML = `
      <div class="file-info">
        <div class="file-info-icon">${isVideo ? '🎬' : '🎵'}</div>
        <div class="file-info-details">
          <div class="file-info-name">${escapeHtml(file.name)}</div>
          <div class="file-info-meta">${size} · ${isVideo ? 'Video' : 'Audio'}</div>
        </div>
        <button class="file-remove-btn" id="file-remove-btn" title="Remove file">✕</button>
      </div>
    `;

    // Wire up red X button
    document.getElementById('file-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      resetApp();
    });
  }

  // ============================================
  // PROCESSING LOG UI
  // ============================================
  function showProcessingWithLog() {
    isProcessing = true;
    processingStatus.classList.add('active');
    progressBar.style.width = '0%';
    processingLog.innerHTML = '';

    // Add decode step
    addLogStep('decode', '📂', 'Decoding Audio');

    // Add all processing steps
    for (const step of ALL_STEPS) {
      addLogStep(step.key, step.icon, step.name);
    }

    // Hide player sections
    waveformPanel.classList.remove('active');
    playerControls.classList.remove('active');
    controlsPanel.classList.remove('active');
    freqVisualizer.classList.remove('active');
    presetsPanel.style.display = 'none';
  }

  function addLogStep(key, icon, name) {
    const el = document.createElement('div');
    el.className = 'processing-step';
    el.id = `log-step-${key}`;
    el.innerHTML = `
      <div class="processing-step-icon pending" id="log-icon-${key}">○</div>
      <span class="processing-step-text" id="log-text-${key}">${icon} ${name}</span>
    `;
    processingLog.appendChild(el);
  }

  function updateProcessingLog(key, state, customText) {
    const iconEl = document.getElementById(`log-icon-${key}`);
    const textEl = document.getElementById(`log-text-${key}`);
    if (!iconEl || !textEl) return;

    iconEl.className = `processing-step-icon ${state}`;
    textEl.className = `processing-step-text ${state}`;

    switch (state) {
      case 'pending': iconEl.textContent = '○'; break;
      case 'active': iconEl.textContent = '◉'; break;
      case 'done': iconEl.textContent = '✓'; break;
      case 'skipped': iconEl.textContent = '—'; break;
    }

    if (customText) {
      textEl.textContent = textEl.textContent.split(' ')[0] + ' ' + customText;
    }
  }

  function showProcessing() {
    isProcessing = true;
    processingStatus.classList.add('active');
    progressBar.style.width = '0%';
    waveformPanel.classList.remove('active');
    playerControls.classList.remove('active');
    controlsPanel.classList.remove('active');
    freqVisualizer.classList.remove('active');
    presetsPanel.style.display = 'none';
  }

  function hideProcessing() {
    isProcessing = false;
    processingStatus.classList.remove('active');
  }

  function showPlayerUI() {
    waveformPanel.classList.add('active');
    playerControls.classList.add('active');
    controlsPanel.classList.add('active');
    freqVisualizer.classList.add('active');
    presetsPanel.style.display = '';
    presetsPanel.classList.add('active');

    WaveformVisualizer.drawWaveform(AudioEngine.getOriginalBuffer(), AudioEngine.getCleanedBuffer());
    timeDuration.textContent = WaveformVisualizer.formatTime(AudioEngine.getDuration());
    timeCurrent.textContent = '0:00';
    toggleText.textContent = 'Cleaned';
    btnToggle.classList.add('active');
  }

  function syncSettingsFromUI() {
    AudioEngine.updateSetting('noiseEnabled', noiseToggle.checked);
    AudioEngine.updateSetting('noiseAmount', noiseAmount.value / 100);
    const noiseThreshold = document.getElementById('noise-threshold');
    if (noiseThreshold) {
      AudioEngine.updateSetting('noiseThreshold', noiseThreshold.value / 100);
    }
    AudioEngine.updateSetting('eqEnabled', eqToggle.checked);
    AudioEngine.updateSetting('eqAmount', eqAmount.value / 100);
    AudioEngine.updateSetting('reverbEnabled', reverbToggle.checked);
    AudioEngine.updateSetting('reverbAmount', reverbAmount.value / 100);
    AudioEngine.updateSetting('deEsserEnabled', deesserToggle.checked);
    AudioEngine.updateSetting('deEsserAmount', deesserAmount.value / 100);
    AudioEngine.updateSetting('levelEnabled', levelToggle.checked);
    AudioEngine.updateSetting('silenceTrimEnabled', silenceToggle.checked);
    const activeMode = silenceModeToggle.querySelector('.mode-btn.active');
    AudioEngine.updateSetting('silenceTrimMode', activeMode ? activeMode.dataset.mode : 'compress');

    syncChipsFromSettings();
  }

  function resetApp() {
    currentProcessId++; // Invalidate active processing group immediately
    AudioEngine.stop();
    WaveformVisualizer.stopFrequencyVisualizer();
    stopPlaybackTimer();
    currentFile = null;
    isProcessing = false;

    dropZone.classList.remove('has-file');
    dropZone.innerHTML = `
      <span class="drop-zone-icon">🎵</span>
      <p class="drop-zone-text">Drop your audio or video files here</p>
      <p class="drop-zone-hint">or <span class="browse-link">click to browse</span> — MP3, WAV, OGG, FLAC, M4A, MP4, MOV, WEBM</p>
    `;
    fileInput.value = '';

    processingStatus.classList.remove('active');
    waveformPanel.classList.remove('active');
    playerControls.classList.remove('active');
    controlsPanel.classList.remove('active');
    freqVisualizer.classList.remove('active');
    presetsPanel.style.display = 'none';
    presetsPanel.classList.remove('active');
    updatePlayButton(false);

    // Hide quick settings panel
    const quickPanel = document.getElementById('quick-settings-panel');
    if (quickPanel) quickPanel.style.display = 'none';
  }

  // ============================================
  // PRESETS
  // ============================================
  function bindPresetEvents() {
    presetsBar.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const preset = chip.dataset.preset;
        applyPresetToUI(preset);
      });
    });
  }

  function applyPresetToUI(presetKey) {
    const newSettings = AudioEngine.applyPreset(presetKey);
    if (!newSettings) return;

    // Update active chip
    presetsBar.querySelectorAll('.preset-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.preset === presetKey);
    });

    if (presetKey === 'custom') return;

    // Sync UI with new settings
    noiseToggle.checked = newSettings.noiseEnabled;
    noiseAmount.value = Math.round(newSettings.noiseAmount * 100);
    noiseValue.textContent = noiseAmount.value + '%';

    eqToggle.checked = newSettings.eqEnabled;
    eqAmount.value = Math.round(newSettings.eqAmount * 100);
    eqValue.textContent = eqAmount.value + '%';

    reverbToggle.checked = newSettings.reverbEnabled;
    reverbAmount.value = Math.round(newSettings.reverbAmount * 100);
    reverbValue.textContent = reverbAmount.value + '%';

    deesserToggle.checked = newSettings.deEsserEnabled;
    deesserAmount.value = Math.round(newSettings.deEsserAmount * 100);
    deesserValue.textContent = deesserAmount.value + '%';

    levelToggle.checked = newSettings.levelEnabled;

    silenceToggle.checked = newSettings.silenceTrimEnabled;
    silenceModeToggle.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === newSettings.silenceTrimMode);
    });

    // Sync two-way sliders
    if (newSettings.noiseThreshold !== undefined) {
      const threshVal = Math.round(newSettings.noiseThreshold * 100);
      const mainThresh = document.getElementById('noise-threshold');
      const mainThreshVal = document.getElementById('noise-threshold-value');
      const quickThresh = document.getElementById('quick-noise-threshold');
      const quickThreshVal = document.getElementById('quick-noise-threshold-value');

      if (mainThresh) mainThresh.value = threshVal;
      if (mainThreshVal) mainThreshVal.textContent = threshVal + '%';
      if (quickThresh) quickThresh.value = threshVal;
      if (quickThreshVal) quickThreshVal.textContent = threshVal + '%';
    }

    document.getElementById('quick-noise-amount').value = noiseAmount.value;
    document.getElementById('quick-noise-value').textContent = noiseAmount.value + '%';
    document.getElementById('quick-eq-amount').value = eqAmount.value;
    document.getElementById('quick-eq-value').textContent = eqAmount.value + '%';
    document.getElementById('quick-reverb-amount').value = reverbAmount.value;
    document.getElementById('quick-reverb-value').textContent = reverbAmount.value + '%';
    document.getElementById('quick-deesser-amount').value = deesserAmount.value;
    document.getElementById('quick-deesser-value').textContent = deesserAmount.value + '%';

    syncChipsFromSettings();
    scheduleReprocess();
  }

  // ============================================
  // EXPORT
  // ============================================
  function bindExportEvents() {
    btnExport.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      exportDropdown.classList.toggle('open');
    });

    btnExport.addEventListener('click', () => {
      if (exportDropdown.classList.contains('open')) {
        exportDropdown.classList.remove('open');
        return;
      }
      exportAudio();
    });

    exportDropdown.querySelectorAll('.export-option').forEach(opt => {
      opt.addEventListener('click', () => {
        selectedExportFormat = opt.dataset.format;
        exportDropdown.querySelectorAll('.export-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');

        const labels = { 'wav': 'Export WAV', 'mp3-320': 'Export MP3', 'mp3-128': 'Export MP3' };
        exportLabel.textContent = labels[selectedExportFormat] || 'Export';
        exportDropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.export-group')) {
        exportDropdown.classList.remove('open');
      }
    });
  }

  async function exportAudio() {
    const buffer = AudioEngine.getCleanedBuffer();
    if (!buffer) return;

    const filename = currentFile ? currentFile.name : 'recording.wav';

    // If video file loaded, mux back
    if (currentFile && VideoProcessor.isVideoFile(currentFile)) {
      try {
        processingText.textContent = 'Preparing video export...';
        showProcessing();
        const wavBlob = VideoProcessor.audioBufferToWavBlob(buffer);
        const videoBlob = await VideoProcessor.muxAudio(currentFile, wavBlob, (text) => {
          processingText.textContent = text;
        });
        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.replace(/\.[^.]+$/, '-clearvox') + (filename.match(/\.[^.]+$/) || ['.mp4'])[0];
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
        hideProcessing();
        showPlayerUI();
        return;
      } catch (err) {
        console.error('Video export error:', err);
        hideProcessing();
        showPlayerUI();
      }
    }

    await AudioExporter.exportAudio(buffer, filename, selectedExportFormat, (text) => {
      processingText.textContent = text;
    });
  }

  // ============================================
  // BATCH PROCESSING
  // ============================================
  function handleBatchFiles(files) {
    batchPanel.classList.add('active');
    batchPanel.style.display = '';

    BatchProcessor.init(async (file, onProgress) => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      syncSettingsFromUI();
      const s = AudioEngine.getSettings();

      let buffer = copyAudioBuffer(audioBuffer);

      const steps = [];
      if (s.noiseEnabled) steps.push('noise');
      if (s.reverbEnabled) steps.push('reverb');
      if (s.eqEnabled) steps.push('eq');
      if (s.deEsserEnabled) steps.push('deesser');
      if (s.levelEnabled) steps.push('level');
      if (s.silenceTrimEnabled) steps.push('silence');

      for (let i = 0; i < steps.length; i++) {
        const progress = ((i + 1) / steps.length) * 100;
        const name = { noise: 'Noise Removal', reverb: 'De-Reverb', eq: 'EQ', deesser: 'De-Esser', level: 'Leveling', silence: 'Trimming' }[steps[i]];
        if (onProgress) onProgress(progress, name);

        switch (steps[i]) {
          case 'noise': buffer = NoiseReduction.applyNoiseGate(buffer, s.noiseAmount); break;
          case 'reverb': buffer = NoiseReduction.applyDeReverb(buffer, s.reverbAmount); break;
          case 'eq': buffer = await applyEQOffline(buffer, s.eqAmount); break;
          case 'deesser': buffer = DeEsser.apply(buffer, s.deEsserAmount); break;
          case 'level': buffer = applyLevelOffline(buffer); break;
          case 'silence': buffer = SilenceTrimmer.apply(buffer, { mode: s.silenceTrimMode, sensitivity: s.silenceTrimSensitivity }); break;
        }

        await new Promise(r => setTimeout(r, 20));
      }

      const blob = AudioExporter.audioBufferToWav(buffer);
      const filename = file.name.replace(/\.[^/.]+$/, '') + '-clearvox.wav';

      ctx.close();
      return { buffer, blob, filename };
    }, renderBatchQueue);

    BatchProcessor.addFiles(files);
  }

  function copyAudioBuffer(buffer) {
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const copy = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) copy.getChannelData(ch).set(buffer.getChannelData(ch));
    return copy;
  }

  async function applyEQOffline(buffer, amount) {
    const offCtx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const src = offCtx.createBufferSource(); src.buffer = buffer;
    const hp = offCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
    const ls = offCtx.createBiquadFilter(); ls.type = 'lowshelf'; ls.frequency.value = 250; ls.gain.value = 2.5 * amount;
    const pr = offCtx.createBiquadFilter(); pr.type = 'peaking'; pr.frequency.value = 3000; pr.Q.value = 1.2; pr.gain.value = 3 * amount;
    const hs = offCtx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 10000; hs.gain.value = 2 * amount;
    src.connect(hp).connect(ls).connect(pr).connect(hs).connect(offCtx.destination);
    src.start(0);
    return offCtx.startRendering();
  }

  function applyLevelOffline(buffer) {
    const out = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
      .createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const inp = buffer.getChannelData(ch), o = out.getChannelData(ch);
      let env = 0;
      for (let i = 0; i < inp.length; i++) {
        const a = Math.abs(inp[i]);
        env = a > env ? 0.99 * env + 0.01 * a : 0.9999 * env + 0.0001 * a;
        let g = 1;
        if (env > 0.15) g = (0.15 * Math.pow(env / 0.15, 0.25)) / (env + 1e-10);
        o[i] = Math.tanh(inp[i] * g * 1.8);
      }
    }
    return out;
  }

  function renderBatchQueue(queue, stats) {
    batchList.innerHTML = queue.map(item => {
      const stateIcons = { queued: '⏳', processing: '⚙️', done: '✅', error: '❌' };
      return `
        <div class="batch-item" data-id="${item.id}">
          <div class="batch-item-icon ${item.state}">${stateIcons[item.state]}</div>
          <div class="batch-item-info">
            <div class="batch-item-name">${escapeHtml(item.file.name)}</div>
            <div class="batch-item-status">${item.state === 'processing' ? item.progressText || 'Processing...' : item.state === 'done' ? 'Done ✨' : item.state === 'error' ? item.error : 'Queued'}</div>
            ${item.state === 'processing' ? `<div class="batch-item-progress"><div class="batch-item-progress-bar" style="width:${item.progress}%"></div></div>` : ''}
          </div>
          <div class="batch-item-actions">
            ${item.state === 'done' ? `<button class="batch-item-btn download" onclick="BatchProcessor.getQueue().find(q=>q.id==='${item.id}')?.result && (() => { const u=URL.createObjectURL(BatchProcessor.getQueue().find(q=>q.id==='${item.id}').result.blob); const a=document.createElement('a'); a.href=u; a.download=BatchProcessor.getQueue().find(q=>q.id==='${item.id}').result.filename; a.click(); })()">📥</button>` : ''}
            ${item.state !== 'processing' ? `<button class="batch-item-btn remove" onclick="BatchProcessor.removeItem('${item.id}')">✕</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    batchStats.innerHTML = `
      <span><span class="batch-stat-label">Total:</span><span class="batch-stat-value">${stats.total}</span></span>
      <span><span class="batch-stat-label">Done:</span><span class="batch-stat-value">${stats.done}</span></span>
      <span><span class="batch-stat-label">Queued:</span><span class="batch-stat-value">${stats.queued}</span></span>
    `;
  }

  function bindBatchEvents() {
    document.getElementById('batch-download-all')?.addEventListener('click', () => {
      BatchProcessor.downloadAllAsZip((text) => { processingText.textContent = text; });
    });
    document.getElementById('batch-clear')?.addEventListener('click', () => {
      BatchProcessor.clearCompleted();
      const q = BatchProcessor.getQueue();
      if (q.length === 0) { batchPanel.classList.remove('active'); batchPanel.style.display = 'none'; }
    });
  }

  // ============================================
  // PLAYBACK
  // ============================================
  function togglePlayback() {
    if (AudioEngine.getIsPlaying()) {
      AudioEngine.pause();
      updatePlayButton(false);
      WaveformVisualizer.stopFrequencyVisualizer();
      stopPlaybackTimer();
    } else {
      AudioEngine.play(onPlaybackEnded);
      updatePlayButton(true);
      const analyser = AudioEngine.getAnalyser();
      if (analyser) WaveformVisualizer.startFrequencyVisualizer(analyser);
      startPlaybackTimer();
    }
  }

  function onPlaybackEnded() {
    updatePlayButton(false);
    WaveformVisualizer.stopFrequencyVisualizer();
    stopPlaybackTimer();
    WaveformVisualizer.updateCursor(0);
    timeCurrent.textContent = '0:00';
  }

  function updatePlayButton(playing) {
    playIcon.textContent = playing ? '⏸' : '▶';
    playText.textContent = playing ? 'Pause' : 'Play';
  }

  function startPlaybackTimer() { stopPlaybackTimer(); playbackTimer = setInterval(updateTimeDisplay, 50); }
  function stopPlaybackTimer() { if (playbackTimer) { clearInterval(playbackTimer); playbackTimer = null; } }

  function updateTimeDisplay() {
    const c = AudioEngine.getCurrentTime(), d = AudioEngine.getDuration();
    timeCurrent.textContent = WaveformVisualizer.formatTime(c);
    if (d > 0) WaveformVisualizer.updateCursor(c / d);
  }

  // ============================================
  // BEFORE / AFTER
  // ============================================
  function toggleBeforeAfter() {
    const isCleaned = AudioEngine.toggleVersion(onPlaybackEnded);
    toggleText.textContent = isCleaned ? 'Cleaned' : 'Original';
    btnToggle.classList.toggle('active', isCleaned);

    if (isCleaned) {
      WaveformVisualizer.drawWaveform(AudioEngine.getOriginalBuffer(), AudioEngine.getCleanedBuffer());
    } else {
      WaveformVisualizer.drawWaveform(AudioEngine.getCleanedBuffer(), AudioEngine.getOriginalBuffer());
    }

    if (AudioEngine.getIsPlaying()) {
      const analyser = AudioEngine.getAnalyser();
      if (analyser) WaveformVisualizer.startFrequencyVisualizer(analyser);
    }
  }

  // ============================================
  // REPROCESS
  // ============================================
  function scheduleReprocess() {
    presetsBar.querySelectorAll('.preset-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.preset === 'custom');
    });

    if (!currentFile || isProcessing) return;
    if (reprocessTimeout) clearTimeout(reprocessTimeout);

    reprocessTimeout = setTimeout(async () => {
      const wasPlaying = AudioEngine.getIsPlaying();
      const currentTime = AudioEngine.getCurrentTime();

      if (wasPlaying) {
        AudioEngine.pause();
        updatePlayButton(false);
        WaveformVisualizer.stopFrequencyVisualizer();
        stopPlaybackTimer();
      }

      showProcessingWithLog();
      updateProcessingLog('decode', 'done');

      const myProcessId = ++currentProcessId;

      try {
        await processWithLog(myProcessId);
        if (myProcessId !== currentProcessId) return;

        progressBar.style.width = '100%';
        processingText.textContent = 'All done! ✨';
        await sleep(350);

        if (myProcessId !== currentProcessId) return;
        hideProcessing();
        showPlayerUI();

        if (wasPlaying) {
          const duration = AudioEngine.getDuration();
          if (currentTime < duration) {
            AudioEngine.seek(currentTime / duration, onPlaybackEnded);
            AudioEngine.play(onPlaybackEnded);
            updatePlayButton(true);
            const analyser = AudioEngine.getAnalyser();
            if (analyser) WaveformVisualizer.startFrequencyVisualizer(analyser);
            startPlaybackTimer();
          }
        }
      } catch (err) {
        if (myProcessId !== currentProcessId) return;
        console.error('Reprocess error:', err);
        hideProcessing();
        showPlayerUI();
      }
    }, 600);
  }

  // ============================================
  // UTILITIES
  // ============================================
  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
