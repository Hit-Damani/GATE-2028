/**
 * GATE 2027 — Open Flow Focus Studio Service
 * Continuous count-up deep work engine with interruption-free study sessions,
 * precision Date.now() tracking, and direct logging to Supabase.
 */

window.GateTimerService = {
    secondsElapsed: 0,
    accumulatedSeconds: 0,
    isRunning: false,
    intervalId: null,
    startTime: null,
    activeSubjectId: 'coa',
    C: 2 * Math.PI * 140, // ~879.65px circumference for r=140

    dom: {},

    async init() {
        this.cacheDom();
        if (window.GateStorage?.getLastActiveSubject) {
            this.activeSubjectId = window.GateStorage.getLastActiveSubject() || 'coa';
        }
        await this.populateSubjectPicker();
        this.restoreSavedFlowSession();
        this.bindEvents();
        this.updateDisplay();
        this.updateButtonsUI();
        this.renderStats();
        this.renderHistory();
        window.lucide?.createIcons();
    },

    cacheDom() {
        const id = s => document.getElementById(s);
        this.dom = {
            circleProgress: id('timer-circle-progress'),
            clockDisplay: id('timer-clock-display'),
            clockSubtitle: id('timer-clock-subtitle'),
            statusBadge: id('timer-status-badge'),
            primaryBtn: id('timer-btn-primary'),
            primaryIconWrap: id('timer-primary-icon-wrap'),
            primaryText: id('timer-primary-text'),
            finishBtn: id('timer-btn-finish'),
            resetBtn: id('timer-btn-reset'),
            subjectSelect: id('timer-subject-select'),
            customDropdown: id('custom-subject-dropdown'),
            dropdownTrigger: id('custom-dropdown-trigger'),
            dropdownText: id('dropdown-selected-text'),
            dropdownDot: id('dropdown-selected-dot'),
            dropdownMenu: id('custom-dropdown-menu'),
            statToday: id('timer-stat-today-hours'),
            statSessions: id('timer-stat-total-sessions'),
            statTotal: id('timer-stat-total-hours'),
            historyList: id('timer-history-list'),
            historyCount: id('history-total-count')
        };
    },

    subjects: [],
    subjectsMap: new Map(),

    async populateSubjectPicker() {
        try {
            this.subjects = await window.GateSubjectService?.loadSubjectsData('data/subjects.json') || [];
        } catch (e) {
            this.subjects = [];
        }
        this.subjectsMap = new Map(this.subjects.map(s => [s.id, s]));

        // Hidden select for backward compatibility
        if (this.dom.subjectSelect) {
            this.dom.subjectSelect.innerHTML = this.subjects.map(s => `<option value="${s.id}">${this.getSubjectDisplayName(s.id)}</option>`).join('');
            this.dom.subjectSelect.value = this.activeSubjectId;
        }

        // Custom Glass Dropdown Menu
        if (this.dom.dropdownMenu) {
            this.dom.dropdownMenu.innerHTML = this.subjects.map(s => {
                const color = this.getSubjectColor(s.id);
                const isActive = s.id === this.activeSubjectId;
                const displayName = this.getSubjectDisplayName(s.id);
                return `
                    <div class="custom-dropdown-item ${isActive ? 'active' : ''}" data-id="${s.id}">
                        <div class="item-left">
                            <span class="item-dot" style="background:${color};box-shadow:0 0 8px ${color}"></span>
                            <span class="item-name">${displayName}</span>
                        </div>
                        ${isActive ? '<i data-lucide="check" class="item-check"></i>' : ''}
                    </div>
                `;
            }).join('');

            this.dom.dropdownMenu.querySelectorAll('.custom-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.selectSubject(item.dataset.id);
                });
            });
        }

        this.updateDropdownTriggerUI();
    },

    getSubject(id) {
        return this.subjectsMap.get(id) || { id, name: id ? id.toUpperCase() : 'General Study', accent: 'purple' };
    },

    getSubjectColor(id) {
        const accent = this.getSubject(id).accent || 'purple';
        return `rgb(var(--accent-${accent}, var(--accent-purple)))`;
    },

    getSubjectDisplayName(id) {
        const s = this.getSubject(id);
        return s.shortName || s.name;
    },

    selectSubject(id) {
        this.activeSubjectId = id;
        if (this.dom.subjectSelect) this.dom.subjectSelect.value = id;
        window.GateStorage?.setLastActiveSubject?.(id);
        this.updateDropdownTriggerUI();
        this.closeCustomDropdown();
        this.populateSubjectPicker();
        this.saveFlowState();
    },

    updateDropdownTriggerUI() {
        const sub = this.getSubject(this.activeSubjectId);
        const color = this.getSubjectColor(this.activeSubjectId);
        if (this.dom.dropdownText) this.dom.dropdownText.textContent = sub.shortName || sub.name;
        if (this.dom.dropdownDot) {
            this.dom.dropdownDot.style.background = color;
            this.dom.dropdownDot.style.boxShadow = `0 0 8px ${color}`;
        }
        window.lucide?.createIcons();
    },

    toggleCustomDropdown() {
        this.dom.customDropdown?.classList.toggle('open');
        const isOpen = this.dom.customDropdown?.classList.contains('open');
        this.dom.dropdownTrigger?.setAttribute('aria-expanded', String(isOpen));
        window.lucide?.createIcons();
    },

    closeCustomDropdown() {
        this.dom.customDropdown?.classList.remove('open');
        this.dom.dropdownTrigger?.setAttribute('aria-expanded', 'false');
    },

    bindEvents() {
        this.dom.primaryBtn?.addEventListener('click', () => this.isRunning ? this.pause() : this.start());
        this.dom.finishBtn?.addEventListener('click', () => this.finishAndLog());
        this.dom.resetBtn?.addEventListener('click', () => this.reset());

        // Custom Dropdown trigger
        this.dom.dropdownTrigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCustomDropdown();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.dom.customDropdown?.contains(e.target)) {
                this.closeCustomDropdown();
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                this.closeCustomDropdown();
            }
        });
    },

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startTime = Date.now();
        this.setBadge('FLOWING', 'running');
        this.updateButtonsUI();
        this.saveFlowState();
        clearInterval(this.intervalId);
        this.intervalId = setInterval(() => this.tick(), 250);
    },

    pause() {
        if (!this.isRunning) return;
        this.isRunning = false;
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.accumulatedSeconds = this.secondsElapsed;
        this.setBadge('PAUSED', 'paused');
        this.updateButtonsUI();
        this.updateDisplay();
        this.saveFlowState();
    },

    tick() {
        const currentElapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const next = this.accumulatedSeconds + currentElapsed;
        if (next !== this.secondsElapsed) {
            this.secondsElapsed = next;
            this.updateDisplay();
            // Periodically save state in case browser is closed
            if (this.secondsElapsed % 5 === 0) {
                this.saveFlowState();
            }
        }
    },

    async finishAndLog() {
        this.pause();

        if (this.secondsElapsed < 30) {
            window.GateErrorHandler?.showToast('Sessions under 1 minute are not saved.', 'info', 3000);
            this.reset();
            return;
        }

        const minutes = Math.max(1, Math.round(this.secondsElapsed / 60));
        this.setBadge('SESSION LOGGED 🎉', 'completed');
        await this.logSession(minutes);
        this.reset();
    },

    reset() {
        this.pause();
        this.secondsElapsed = 0;
        this.accumulatedSeconds = 0;
        this.startTime = null;
        this.clearSavedFlowState();
        this.setBadge('READY TO FOCUS', 'ready');
        this.updateDisplay();
        this.updateButtonsUI();
    },

    async logSession(minutes) {
        const subId = this.activeSubjectId || 'coa';
        const subName = this.getSubjectDisplayName(subId);
        let ok = true;
        if (window.GateStorage?.saveStudySession) {
            ok = await window.GateStorage.saveStudySession(subId, minutes, 'stopwatch');
        }
        if (ok) {
            const timeLabel = minutes >= 60 ? `${(minutes / 60).toFixed(1)}h` : `${minutes}m`;
            window.GateErrorHandler?.showToast(`🎉 Logged ${timeLabel} of deep work for ${subName}!`, 'success', 4000);
            this.renderStats();
            this.renderHistory();
        } else {
            window.GateErrorHandler?.showToast('Unable to save your study session. Please try again.', 'error', 4000);
        }
    },

    setBadge(text, cls) {
        if (!this.dom.statusBadge) return;
        this.dom.statusBadge.textContent = text;
        this.dom.statusBadge.className = `timer-status-badge ${cls}`;
    },

    formatTime(secs) {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (hrs > 0) {
            return `${hrs}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    updateDisplay() {
        const timeStr = this.formatTime(this.secondsElapsed);
        if (this.dom.clockDisplay) {
            this.dom.clockDisplay.textContent = timeStr;
            this.dom.clockDisplay.classList.toggle('has-hours', timeStr.length > 5);
        }

        if (this.dom.clockSubtitle) {
            if (this.secondsElapsed === 0) {
                this.dom.clockSubtitle.textContent = 'Deep Work';
            } else {
                const hrs = (this.secondsElapsed / 3600).toFixed(1);
                const mins = Math.floor(this.secondsElapsed / 60);
                this.dom.clockSubtitle.textContent = this.secondsElapsed >= 60 ? `${hrs}h Logged (${mins} mins)` : `${this.secondsElapsed}s Elapsed`;
            }
        }

        if (this.dom.circleProgress) {
            // Fills smoothly across a 60-minute loop, completing full circle each hour
            const cycle = (this.secondsElapsed % 3600) / 3600;
            const offset = this.secondsElapsed === 0 ? this.C : (this.C * (1 - cycle));
            this.dom.circleProgress.style.strokeDashoffset = offset.toFixed(2);
        }

        if (this.isRunning) {
            document.title = `(${timeStr}) Flow — GATE 2027`;
        } else if (this.secondsElapsed > 0) {
            document.title = `[Paused] (${timeStr}) Flow — GATE 2027`;
        } else {
            document.title = 'Focus Studio — GATE 2027';
        }
    },

    updateButtonsUI() {
        if (!this.dom.primaryBtn) return;
        const btn = this.dom.primaryBtn;

        if (this.isRunning) {
            btn.className = 'timer-main-btn pause';
            if (this.dom.primaryText) this.dom.primaryText.textContent = 'Pause';
            if (this.dom.primaryIconWrap) this.dom.primaryIconWrap.innerHTML = '<i data-lucide="pause"></i>';
        } else {
            btn.className = 'timer-main-btn play';
            const hasStarted = this.secondsElapsed > 0;
            if (this.dom.primaryText) this.dom.primaryText.textContent = hasStarted ? 'Resume' : 'Start Flow';
            if (this.dom.primaryIconWrap) this.dom.primaryIconWrap.innerHTML = '<i data-lucide="play"></i>';
        }

        // Finish button is visible whenever a session has started or is running
        if (this.dom.finishBtn) {
            const canFinish = this.secondsElapsed >= 10 || this.isRunning;
            this.dom.finishBtn.style.display = canFinish ? 'inline-flex' : 'none';
        }

        // Reset button visible when paused with time on clock
        if (this.dom.resetBtn) {
            const canReset = this.secondsElapsed > 0 && !this.isRunning;
            this.dom.resetBtn.style.display = canReset ? 'inline-flex' : 'none';
        }

        window.lucide?.createIcons();
    },

    saveFlowState() {
        if (this.secondsElapsed === 0 && !this.isRunning) {
            this.clearSavedFlowState();
            return;
        }
        try {
            const state = {
                accumulatedSeconds: this.accumulatedSeconds,
                startTime: this.startTime,
                isRunning: this.isRunning,
                subjectId: this.activeSubjectId,
                timestamp: Date.now()
            };
            localStorage.setItem('gate_flow_state', JSON.stringify(state));
        } catch (e) {}
    },

    clearSavedFlowState() {
        try {
            localStorage.removeItem('gate_flow_state');
        } catch (e) {}
    },

    restoreSavedFlowSession() {
        try {
            const raw = localStorage.getItem('gate_flow_state');
            if (!raw) return;
            const state = JSON.parse(raw);
            if (!state) return;

            if (state.subjectId) {
                this.activeSubjectId = state.subjectId;
            }

            if (state.isRunning && state.startTime) {
                const now = Date.now();
                const diffSecs = Math.floor((now - state.startTime) / 1000);
                this.accumulatedSeconds = (state.accumulatedSeconds || 0) + diffSecs;
                this.secondsElapsed = this.accumulatedSeconds;
                this.isRunning = true;
                this.startTime = now;
                this.setBadge('FLOWING', 'running');
                clearInterval(this.intervalId);
                this.intervalId = setInterval(() => this.tick(), 250);
            } else if (state.accumulatedSeconds > 0) {
                this.accumulatedSeconds = state.accumulatedSeconds;
                this.secondsElapsed = state.accumulatedSeconds;
                this.setBadge('PAUSED', 'paused');
            }
        } catch (e) {}
    },

    renderStats() {
        const stats = window.GateStorage?.getDeepWorkStats?.();
        if (!stats) return;
        if (this.dom.statToday) this.dom.statToday.textContent = `${stats.todayHours}h`;
        if (this.dom.statSessions) this.dom.statSessions.textContent = `${stats.sessionCount}`;
        if (this.dom.statTotal) this.dom.statTotal.textContent = `${stats.totalHours}h`;
    },

    renderHistory() {
        if (!this.dom.historyList) return;
        const sessions = window.GateStorage?.getStudySessions?.() || [];
        if (this.dom.historyCount) this.dom.historyCount.textContent = `${sessions.length} Sessions`;

        if (!sessions.length) {
            this.dom.historyList.innerHTML = '<div class="history-empty-state">No focus sessions recorded yet. Start above! 🚀</div>';
            return;
        }

        this.dom.historyList.innerHTML = sessions.slice(0, 10).map(s => {
            const mins = Number(s.duration_minutes) || 0;
            const sub = this.getSubjectDisplayName(s.subject_id);
            const rawDate = s.session_date || (s.created_at ? s.created_at.split('T')[0] : '');
            const dateDisplay = this.formatSessionDate(rawDate);
            const durationLabel = mins >= 60 ? `+${(mins / 60).toFixed(1)}h` : `+${mins}m`;

            return `<div class="history-session-item">
                <div class="session-left-meta">
                    <span class="session-subject-name">${sub}</span>
                    <div class="session-sub-row">
                        <span class="session-time-ago">${dateDisplay}</span>
                    </div>
                </div>
                <div class="session-right-meta">
                    <span class="session-duration">${durationLabel}</span>
                </div>
            </div>`;
        }).join('');
    },

    formatSessionDate(dateStr) {
        if (!dateStr) return 'Today';
        const todayStr = new Date().toISOString().split('T')[0];
        if (dateStr === todayStr) return 'Today';

        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yStr = y.toISOString().split('T')[0];
        if (dateStr === yStr) return 'Yesterday';

        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const mo = Number(parts[1]);
                const dy = Number(parts[2]);
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                if (mo >= 1 && mo <= 12) return `${dy} ${months[mo - 1]}`;
            }
        } catch (e) {}
        return dateStr;
    }
};
