/**
 * Silly Game Plus (SillyTavern-SheepBlock)
 * 适配 SillyTavern 酒馆全端小游戏扩展插件
 * 1. 独立主页选择大厅 (Home Hub)
 * 2. 🐑 羊了个羊 (爽玩增强版：道具5次+无限补充+5格暂存区+全屏自适应+进度保存+暂停)
 * 3. 🧱 现代俄罗斯方块 (7-Bag 发牌 + 幽灵投影 + Hold暂存 + 触屏虚拟手柄 + 进度保存 + 暂停)
 * 4. 完美适配酒馆扩展菜单与移动端定位安全
 */

(() => {
  'use strict';

  const PLUGIN_ID = 'silly-game-plus';
  const LAUNCHER_POS_KEY = 'stgc-launcher-pos-v2';
  const LAUNCHER_HIDDEN_KEY = 'stgc-launcher-hidden-v2';
  const SHEEP_STORAGE_KEY = 'stgc-sheep-save-v2';
  const TETRIS_STORAGE_KEY = 'stgc-tetris-save-v2';

  // ================= 1. 程序化音频合成引擎 =================
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      } catch (e) {}
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    toggle() {
      this.enabled = !this.enabled;
      return this.enabled;
    }

    playTone(freq, type, duration, endFreq) {
      if (!this.enabled || !this.ctx) return;
      this.resume();
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    }

    playClick() { this.playTone(450, 'sine', 0.07, 750); }
    playDock() { this.playTone(300, 'triangle', 0.06, 160); }
    playMatch() {
      if (!this.enabled || !this.ctx) return;
      this.resume();
      [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'sine', 0.18), i * 35);
      });
    }
    playTool() { this.playTone(600, 'square', 0.1, 300); }
    playRotate() { this.playTone(400, 'triangle', 0.05, 520); }
    playLineClear() {
      if (!this.enabled || !this.ctx) return;
      this.resume();
      [659.25, 783.99, 987.77].forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'square', 0.12), i * 40);
      });
    }
    playTetrisClear() {
      if (!this.enabled || !this.ctx) return;
      this.resume();
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'sine', 0.22), i * 50);
      });
    }
    playWin() {
      if (!this.enabled || !this.ctx) return;
      this.resume();
      [440, 554.37, 659.25, 880].forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'triangle', 0.25), i * 70);
      });
    }
    playLose() { this.playTone(360, 'sawtooth', 0.45, 120); }
  }

  const sound = new SoundEngine();

  // ================= 2. 游戏 1: 羊了个羊增强版引擎 =================
  const SHEEP_TYPES = [
    { type: 'sheep', icon: '🐑', name: '小羊' },
    { type: 'grass', icon: '🌿', name: '青草' },
    { type: 'carrot', icon: '🥕', name: '胡萝卜' },
    { type: 'wool', icon: '🧶', name: '毛线' },
    { type: 'bell', icon: '🔔', name: '铃铛' },
    { type: 'milk', icon: '🍼', name: '奶瓶' },
    { type: 'wood', icon: '🪵', name: '树桩' },
    { type: 'glove', icon: '🧤', name: '手套' },
    { type: 'hat', icon: '👒', name: '草帽' },
    { type: 'fire', icon: '🔥', name: '篝火' },
    { type: 'apple', icon: '🍎', name: '苹果' },
    { type: 'corn', icon: '🌽', name: '玉米' }
  ];

  class SheepEngine {
    constructor(container, onBackHome) {
      this.container = container;
      this.onBackHome = onBackHome;
      this.currentLevel = 1;
      this.allCards = [];
      this.dockList = [];
      this.holdingList = [];
      this.historyStack = [];
      this.isAnimating = false;
      this.hasRevived = false;
      this.isPaused = false;

      this.toolsCount = { moveOut: 5, undo: 5, shuffle: 5 };

      this.initDOM();
      this.bindEvents();

      // 尝试恢复存档，若无存档则启动第 1 关
      if (!this.loadState()) {
        this.startLevel(1);
      }
    }

    initDOM() {
      this.container.innerHTML = `
        <div class="sheep-wrapper">
          <!-- 顶部子操作栏 -->
          <div class="sheep-sub-header">
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="sheep-mini-btn" id="sheepBackBtn" title="返回主页">← 主页</button>
              <span class="sheep-badge" id="sheepLevelBadge">第 1 关</span>
              <span class="sheep-remain">余: <b id="sheepRemain">0</b></span>
            </div>
            <div class="sheep-actions-top">
              <button class="sheep-mini-btn" id="sheepPauseBtn" title="暂停/继续">⏸</button>
              <button class="sheep-mini-btn supply" id="sheepSupplyBtn" title="补充全部道具+3次">⚡ 补给(+3)</button>
              <button class="sheep-mini-btn" id="sheepRestartBtn" title="重新开始本关">🔄</button>
            </div>
          </div>

          <!-- 5格大容量暂存区 -->
          <div class="sheep-holding">
            <div class="sheep-holding-label">暂存区 (最多5格，可随时点击收回)</div>
            <div class="sheep-holding-slots" id="sheepHoldingSlots"></div>
          </div>

          <!-- 弹性卡牌主舞台 -->
          <div class="sheep-stage-box">
            <div class="sheep-stage" id="sheepStage"></div>
          </div>

          <!-- 7格卡槽 -->
          <div class="sheep-dock-wrap">
            <div class="sheep-dock">
              <div class="sheep-dock-slots-bg">
                <div class="sheep-dock-cell"></div>
                <div class="sheep-dock-cell"></div>
                <div class="sheep-dock-cell"></div>
                <div class="sheep-dock-cell"></div>
                <div class="sheep-dock-cell"></div>
                <div class="sheep-dock-cell"></div>
                <div class="sheep-dock-cell"></div>
              </div>
              <div class="sheep-dock-cards" id="sheepDockCards"></div>
            </div>
          </div>

          <!-- 底部道具栏 (完全钉在底部，100%全显) -->
          <div class="sheep-tools">
            <button class="sheep-tool-btn" id="sheepToolMove">
              <span class="sheep-tool-icon">📤</span>
              <span class="sheep-tool-name">移出</span>
              <span class="sheep-tool-num" id="sheepNumMove">5</span>
            </button>
            <button class="sheep-tool-btn" id="sheepToolUndo">
              <span class="sheep-tool-icon">↩️</span>
              <span class="sheep-tool-name">撤销</span>
              <span class="sheep-tool-num" id="sheepNumUndo">5</span>
            </button>
            <button class="sheep-tool-btn" id="sheepToolShuffle">
              <span class="sheep-tool-icon">🔀</span>
              <span class="sheep-tool-name">洗牌</span>
              <span class="sheep-tool-num" id="sheepNumShuffle">5</span>
            </button>
          </div>

          <!-- 暂停遮罩 -->
          <div class="stgc-pause-mask" id="sheepPauseMask">
            <div class="stgc-pause-icon">⏸</div>
            <div class="stgc-pause-title">游戏已暂停</div>
            <div class="stgc-pause-hint">点击屏幕任意处继续</div>
          </div>

          <!-- 结算弹窗 -->
          <div class="stgc-alert-overlay" id="sheepModal">
            <div class="stgc-alert-box">
              <div class="stgc-alert-icon" id="sheepModalIcon">🐑</div>
              <div class="stgc-alert-title" id="sheepModalTitle">提示</div>
              <div class="stgc-alert-desc" id="sheepModalDesc">描述信息</div>
              <div class="stgc-alert-btns">
                <button class="stgc-btn-p" id="sheepModalOk">确认</button>
                <button class="stgc-btn-s" id="sheepModalRevive" style="display:none;">复活继续</button>
              </div>
            </div>
          </div>
        </div>
      `;

      this.stageEl = this.container.querySelector('#sheepStage');
      this.dockContainer = this.container.querySelector('#sheepDockCards');
      this.holdingSlots = this.container.querySelector('#sheepHoldingSlots');
      this.remainEl = this.container.querySelector('#sheepRemain');
      this.levelBadge = this.container.querySelector('#sheepLevelBadge');
      this.pauseMask = this.container.querySelector('#sheepPauseMask');
      this.pauseBtn = this.container.querySelector('#sheepPauseBtn');

      this.toolMoveBtn = this.container.querySelector('#sheepToolMove');
      this.toolUndoBtn = this.container.querySelector('#sheepToolUndo');
      this.toolShuffleBtn = this.container.querySelector('#sheepToolShuffle');
      this.numMoveEl = this.container.querySelector('#sheepNumMove');
      this.numUndoEl = this.container.querySelector('#sheepNumUndo');
      this.numShuffleEl = this.container.querySelector('#sheepNumShuffle');

      this.modalEl = this.container.querySelector('#sheepModal');
      this.modalIcon = this.container.querySelector('#sheepModalIcon');
      this.modalTitle = this.container.querySelector('#sheepModalTitle');
      this.modalDesc = this.container.querySelector('#sheepModalDesc');
      this.modalOkBtn = this.container.querySelector('#sheepModalOk');
      this.modalReviveBtn = this.container.querySelector('#sheepModalRevive');
    }

    bindEvents() {
      this.container.querySelector('#sheepBackBtn').addEventListener('click', () => {
        this.saveState();
        if (this.onBackHome) this.onBackHome();
      });

      this.container.querySelector('#sheepRestartBtn').addEventListener('click', () => {
        this.clearState();
        this.startLevel(this.currentLevel);
      });

      this.container.querySelector('#sheepSupplyBtn').addEventListener('click', () => {
        this.toolsCount.moveOut += 3;
        this.toolsCount.undo += 3;
        this.toolsCount.shuffle += 3;
        sound.playTool();
        this.updateToolsUI();
        this.saveState();
      });

      this.pauseBtn.addEventListener('click', () => this.togglePause());
      this.pauseMask.addEventListener('click', () => this.togglePause(false));

      this.toolMoveBtn.addEventListener('click', () => this.useToolMoveOut());
      this.toolUndoBtn.addEventListener('click', () => this.useToolUndo());
      this.toolShuffleBtn.addEventListener('click', () => this.useToolShuffle());

      this.modalOkBtn.addEventListener('click', () => {
        this.modalEl.classList.remove('active');
        if (this.modalOkBtn.dataset.action === 'next') {
          this.clearState();
          this.startLevel(2);
        } else {
          this.clearState();
          this.startLevel(this.currentLevel);
        }
      });

      this.modalReviveBtn.addEventListener('click', () => {
        this.modalEl.classList.remove('active');
        this.revive();
      });

      window.addEventListener('resize', () => this.adjustStageScale());
    }

    adjustStageScale() {
      const box = this.container.querySelector('.sheep-stage-box');
      if (!box || !this.stageEl) return;
      const w = box.clientWidth || 360;
      const h = box.clientHeight || 340;
      const scale = Math.min(1, Math.min(w / 360, h / 360));
      this.stageEl.style.transform = `scale(${Math.max(0.72, scale)})`;
    }

    togglePause(force) {
      this.isPaused = force !== undefined ? force : !this.isPaused;
      this.pauseMask.classList.toggle('active', this.isPaused);
      this.pauseBtn.textContent = this.isPaused ? '▶' : '⏸';
    }

    startLevel(lvl) {
      this.currentLevel = lvl;
      this.allCards = [];
      this.dockList = [];
      this.holdingList = [];
      this.historyStack = [];
      this.isAnimating = false;
      this.hasRevived = false;

      this.levelBadge.textContent = `第 ${this.currentLevel} 关`;
      this.dockContainer.innerHTML = '';
      this.holdingSlots.innerHTML = '';

      if (this.currentLevel === 1) {
        this.generateLevel1();
      } else {
        this.generateLevel2();
      }

      this.renderStage();
      this.adjustStageScale();
      this.updateCoveredStatus();
      this.updateRemain();
      this.updateToolsUI();
      this.saveState();
    }

    generateLevel1() {
      const types = SHEEP_TYPES.slice(0, 3);
      const cardPool = [];
      for (let i = 0; i < 6; i++) {
        const item = types[i % types.length];
        for (let j = 0; j < 3; j++) cardPool.push({ ...item });
      }
      this.shuffle(cardPool);

      const positions = [
        { x: 45, y: 55, z: 0 }, { x: 155, y: 55, z: 0 }, { x: 265, y: 55, z: 0 },
        { x: 45, y: 155, z: 0 }, { x: 155, y: 155, z: 0 }, { x: 265, y: 155, z: 0 },
        { x: 45, y: 255, z: 0 }, { x: 155, y: 255, z: 0 }, { x: 265, y: 255, z: 0 },
        { x: 100, y: 105, z: 1 }, { x: 210, y: 105, z: 1 }, { x: 100, y: 205, z: 1 },
        { x: 210, y: 205, z: 1 }, { x: 155, y: 155, z: 1 },
        { x: 130, y: 130, z: 2 }, { x: 180, y: 130, z: 2 }, { x: 130, y: 185, z: 2 }, { x: 180, y: 185, z: 2 },
      ];

      this.allCards = cardPool.map((item, idx) => ({
        id: `sheep_${idx}`,
        type: item.type,
        icon: item.icon,
        name: item.name,
        x: positions[idx].x,
        y: positions[idx].y,
        z: positions[idx].z,
        width: 46,
        height: 50,
        state: 'stage',
        isCovered: false,
        el: null
      }));
    }

    generateLevel2() {
      const positions = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (Math.random() > 0.15) positions.push({ x: 62 + c * 48, y: 50 + r * 50, z: 0 });
        }
      }
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (Math.random() > 0.1) positions.push({ x: 86 + c * 48, y: 75 + r * 50, z: 1 });
        }
      }
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) positions.push({ x: 110 + c * 48, y: 100 + r * 50, z: 2 });
      }
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) positions.push({ x: 134 + c * 48, y: 125 + r * 50, z: 3 });
      }
      positions.push({ x: 158, y: 150, z: 4 });

      // 两侧暗牌堆与底部备用
      for (let i = 0; i < 8; i++) positions.push({ x: 10, y: 65 + i * 5, z: 10 + i });
      for (let i = 0; i < 8; i++) positions.push({ x: 304, y: 65 + i * 5, z: 10 + i });
      for (let i = 0; i < 4; i++) positions.push({ x: 70 + i * 58, y: 315, z: 1 });

      let total = positions.length;
      const rem = total % 3;
      if (rem !== 0) positions.splice(total - rem, rem);
      total = positions.length;

      const cardPool = [];
      for (let i = 0; i < total / 3; i++) {
        const item = SHEEP_TYPES[i % SHEEP_TYPES.length];
        for (let j = 0; j < 3; j++) cardPool.push({ ...item });
      }
      this.shuffle(cardPool);

      this.allCards = positions.map((pos, idx) => ({
        id: `sheep_${idx}`,
        type: cardPool[idx].type,
        icon: cardPool[idx].icon,
        name: cardPool[idx].name,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        width: 46,
        height: 50,
        state: 'stage',
        isCovered: false,
        el: null
      }));
    }

    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    renderStage() {
      this.stageEl.innerHTML = '';
      this.allCards.forEach(card => {
        if (card.state === 'stage') {
          const el = document.createElement('div');
          el.className = 'sheep-card';
          el.id = card.id;
          el.style.left = `${card.x}px`;
          el.style.top = `${card.y}px`;
          el.style.zIndex = card.z;
          el.innerHTML = `
            <div class="sheep-card-icon">${card.icon}</div>
            <div class="sheep-card-name">${card.name}</div>
          `;
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isPaused) return;
            if (card.state === 'stage' || card.state === 'holding') {
              this.handleCardClick(card);
            }
          });
          card.el = el;
          this.stageEl.appendChild(el);
        }
      });
      requestAnimationFrame(() => this.adjustStageScale());
    }

    updateCoveredStatus() {
      const stageCards = this.allCards.filter(c => c.state === 'stage');
      stageCards.forEach(c => c.isCovered = false);

      for (let i = 0; i < stageCards.length; i++) {
        const cardA = stageCards[i];
        for (let j = 0; j < stageCards.length; j++) {
          if (i === j) continue;
          const cardB = stageCards[j];
          if (cardB.z > cardA.z) {
            const overlap = (
              cardA.x < cardB.x + cardB.width - 3 &&
              cardA.x + cardA.width - 3 > cardB.x &&
              cardA.y < cardB.y + cardB.height - 3 &&
              cardA.y + cardA.height - 3 > cardB.y
            );
            if (overlap) {
              cardA.isCovered = true;
              break;
            }
          }
        }
      }

      stageCards.forEach(c => {
        if (c.el) {
          if (c.isCovered) {
            c.el.classList.add('covered');
            c.el.classList.remove('active');
          } else {
            c.el.classList.remove('covered');
            c.el.classList.add('active');
          }
        }
      });
    }

    updateRemain() {
      const cnt = this.allCards.filter(c => c.state !== 'eliminated').length;
      this.remainEl.textContent = cnt;
    }

    updateToolsUI() {
      this.numMoveEl.textContent = this.toolsCount.moveOut;
      this.numUndoEl.textContent = this.toolsCount.undo;
      this.numShuffleEl.textContent = this.toolsCount.shuffle;

      const availHolding = 5 - this.holdingList.length;
      this.toolMoveBtn.disabled = this.toolsCount.moveOut <= 0 || this.dockList.length === 0 || availHolding <= 0;
      this.toolUndoBtn.disabled = this.toolsCount.undo <= 0 || !this.canUndo();
      this.toolShuffleBtn.disabled = this.toolsCount.shuffle <= 0 || this.allCards.filter(c => c.state === 'stage').length === 0;
    }

    canUndo() {
      for (let i = this.historyStack.length - 1; i >= 0; i--) {
        if (this.dockList.includes(this.historyStack[i].card)) return true;
      }
      return false;
    }

    handleCardClick(card) {
      if (this.isAnimating || this.isPaused) return;
      if (card.state === 'stage' && card.isCovered) return;
      if (this.dockList.length >= 7) return;

      sound.playClick();

      if (card.state === 'stage') {
        this.historyStack.push({ card, prevX: card.x, prevY: card.y, prevZ: card.z });
      } else if (card.state === 'holding') {
        const idx = this.holdingList.indexOf(card);
        if (idx > -1) this.holdingList.splice(idx, 1);
        this.renderHolding();
      }

      card.state = 'dock';
      let insertIdx = -1;
      for (let i = this.dockList.length - 1; i >= 0; i--) {
        if (this.dockList[i].type === card.type) {
          insertIdx = i + 1;
          break;
        }
      }
      if (insertIdx === -1) this.dockList.push(card);
      else this.dockList.splice(insertIdx, 0, card);

      this.updateCoveredStatus();
      this.updateRemain();
      this.renderDock();
      sound.playDock();

      setTimeout(() => {
        this.checkMatches();
        this.updateToolsUI();
        this.saveState();
      }, 160);
    }

    renderDock() {
      this.dockContainer.innerHTML = '';
      this.dockList.forEach(card => {
        if (card.el) {
          card.el.className = 'sheep-card active';
          card.el.style.position = 'relative';
          card.el.style.left = 'auto';
          card.el.style.top = 'auto';
          card.el.style.zIndex = '1';
          this.dockContainer.appendChild(card.el);
        }
      });
    }

    renderHolding() {
      this.holdingSlots.innerHTML = '';
      this.holdingList.forEach(card => {
        if (card.el) {
          card.el.className = 'sheep-card active';
          card.el.style.position = 'relative';
          card.el.style.left = 'auto';
          card.el.style.top = 'auto';
          this.holdingSlots.appendChild(card.el);
        }
      });
    }

    checkMatches() {
      const counts = {};
      this.dockList.forEach(c => counts[c.type] = (counts[c.type] || 0) + 1);

      let matchType = null;
      for (const t in counts) {
        if (counts[t] >= 3) { matchType = t; break; }
      }

      if (matchType) {
        sound.playMatch();
        const matched = this.dockList.filter(c => c.type === matchType).slice(0, 3);
        matched.forEach(c => c.el?.classList.add('eliminating'));

        setTimeout(() => {
          matched.forEach(c => {
            c.state = 'eliminated';
            c.el?.remove();
            const idx = this.dockList.indexOf(c);
            if (idx > -1) this.dockList.splice(idx, 1);
          });
          this.renderDock();
          this.updateRemain();
          this.saveState();
          this.checkWin();
        }, 220);
      } else {
        if (this.dockList.length >= 7) {
          this.handleFail();
        }
      }
    }

    checkWin() {
      if (this.allCards.filter(c => c.state !== 'eliminated').length === 0) {
        sound.playWin();
        this.clearState();
        setTimeout(() => {
          this.showAlert({
            icon: '👑',
            title: this.currentLevel === 1 ? '第 1 关通关！' : '全通关！羊群之王！',
            desc: this.currentLevel === 1 ? '恭喜快速通关！是否挑战魔性第 2 关？' : '太不可思议了！你成功征服了地狱难度的第 2 关！',
            okText: this.currentLevel === 1 ? '挑战第 2 关' : '再来一局',
            action: this.currentLevel === 1 ? 'next' : 'restart'
          });
        }, 250);
      }
    }

    handleFail() {
      sound.playLose();
      const canRevive = !this.hasRevived && this.dockList.length >= 3;
      this.showAlert({
        icon: '😵',
        title: '槽位已满！',
        desc: canRevive ? '槽满啦！你可以使用一次免费【复活】，移出前3张牌到暂存区继续游戏！' : '很遗憾，棋差一着！点击重新开始再次挑战吧！',
        okText: '重新开始',
        action: 'restart',
        showRevive: canRevive
      });
    }

    useToolMoveOut() {
      const avail = 5 - this.holdingList.length;
      if (this.toolsCount.moveOut <= 0 || this.dockList.length === 0 || avail <= 0) return;
      this.toolsCount.moveOut--;
      sound.playTool();

      const moved = this.dockList.splice(0, Math.min(avail, Math.min(3, this.dockList.length)));
      moved.forEach(c => {
        c.state = 'holding';
        this.holdingList.push(c);
      });

      this.renderDock();
      this.renderHolding();
      this.updateToolsUI();
      this.saveState();
    }

    useToolUndo() {
      if (this.toolsCount.undo <= 0 || this.historyStack.length === 0) return;
      let target = null;
      let dockIdx = -1;

      while (this.historyStack.length > 0) {
        const item = this.historyStack.pop();
        dockIdx = this.dockList.indexOf(item.card);
        if (dockIdx !== -1) {
          target = item;
          break;
        }
      }

      if (!target || dockIdx === -1) return;
      this.toolsCount.undo--;
      sound.playTool();

      this.dockList.splice(dockIdx, 1);
      this.renderDock();

      const card = target.card;
      card.state = 'stage';
      card.x = target.prevX;
      card.y = target.prevY;
      card.z = target.prevZ;

      const el = card.el;
      el.className = 'sheep-card';
      el.style.position = 'absolute';
      el.style.left = `${card.x}px`;
      el.style.top = `${card.y}px`;
      el.style.zIndex = card.z;
      this.stageEl.appendChild(el);

      this.updateCoveredStatus();
      this.updateRemain();
      this.updateToolsUI();
      this.saveState();
    }

    useToolShuffle() {
      const stageCards = this.allCards.filter(c => c.state === 'stage');
      if (this.toolsCount.shuffle <= 0 || stageCards.length === 0) return;
      this.toolsCount.shuffle--;
      sound.playTool();

      const typesData = stageCards.map(c => ({ type: c.type, icon: c.icon, name: c.name }));
      this.shuffle(typesData);

      stageCards.forEach((c, idx) => {
        c.type = typesData[idx].type;
        c.icon = typesData[idx].icon;
        c.name = typesData[idx].name;
        if (c.el) {
          c.el.innerHTML = `
            <div class="sheep-card-icon">${c.icon}</div>
            <div class="sheep-card-name">${c.name}</div>
          `;
        }
      });
      this.updateToolsUI();
      this.saveState();
    }

    revive() {
      this.hasRevived = true;
      sound.playTool();
      const moved = this.dockList.splice(0, Math.min(3, this.dockList.length));
      moved.forEach(c => {
        c.state = 'holding';
        this.holdingList.push(c);
      });
      this.renderDock();
      this.renderHolding();
      this.updateToolsUI();
      this.saveState();
    }

    // 进度存档
    saveState() {
      try {
        const data = {
          currentLevel: this.currentLevel,
          toolsCount: this.toolsCount,
          hasRevived: this.hasRevived,
          cards: this.allCards.map(c => ({
            id: c.id,
            type: c.type,
            icon: c.icon,
            name: c.name,
            x: c.x,
            y: c.y,
            z: c.z,
            state: c.state
          })),
          dockIds: this.dockList.map(c => c.id),
          holdingIds: this.holdingList.map(c => c.id)
        };
        localStorage.setItem(SHEEP_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
    }

    // 进度读取
    loadState() {
      try {
        const raw = localStorage.getItem(SHEEP_STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.cards) || data.cards.length === 0) return false;

        this.currentLevel = data.currentLevel || 1;
        this.toolsCount = data.toolsCount || { moveOut: 5, undo: 5, shuffle: 5 };
        this.hasRevived = !!data.hasRevived;
        this.levelBadge.textContent = `第 ${this.currentLevel} 关`;

        const cardMap = {};
        this.allCards = data.cards.map(c => {
          const item = { ...c, width: 46, height: 50, isCovered: false, el: null };
          cardMap[item.id] = item;
          return item;
        });

        this.dockList = (data.dockIds || []).map(id => cardMap[id]).filter(Boolean);
        this.holdingList = (data.holdingIds || []).map(id => cardMap[id]).filter(Boolean);

        this.renderStage();
        this.renderDock();
        this.renderHolding();
        this.updateCoveredStatus();
        this.updateRemain();
        this.updateToolsUI();
        this.adjustStageScale();
        return true;
      } catch (e) {
        return false;
      }
    }

    clearState() {
      try { localStorage.removeItem(SHEEP_STORAGE_KEY); } catch (e) {}
    }

    showAlert({ icon, title, desc, okText, action, showRevive }) {
      this.modalIcon.textContent = icon;
      this.modalTitle.textContent = title;
      this.modalDesc.textContent = desc;
      this.modalOkBtn.textContent = okText;
      this.modalOkBtn.dataset.action = action;
      this.modalReviveBtn.style.display = showRevive ? 'inline-block' : 'none';
      this.modalEl.classList.add('active');
    }
  }

  // ================= 3. 游戏 2: 现代俄罗斯方块 (Tetris) 引擎 =================
  const TETRIS_SHAPES = {
    I: { color: '#06b6d4', matrix: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
    J: { color: '#3b82f6', matrix: [[1,0,0],[1,1,1],[0,0,0]] },
    L: { color: '#f97316', matrix: [[0,0,1],[1,1,1],[0,0,0]] },
    O: { color: '#eab308', matrix: [[1,1],[1,1]] },
    S: { color: '#22c55e', matrix: [[0,1,1],[1,1,0],[0,0,0]] },
    T: { color: '#a855f7', matrix: [[0,1,0],[1,1,1],[0,0,0]] },
    Z: { color: '#ef4444', matrix: [[1,1,0],[0,1,1],[0,0,0]] }
  };

  class TetrisEngine {
    constructor(container, onBackHome) {
      this.container = container;
      this.onBackHome = onBackHome;
      this.cols = 10;
      this.rows = 20;
      this.blockSize = 18;

      this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.bag = [];
      this.currentPiece = null;
      this.nextPiece = null;
      this.holdPiece = null;
      this.canHold = true;
      this.isGameOver = false;
      this.isPaused = false;
      this.dropInterval = 800;
      this.lastDropTime = 0;
      this.rafId = null;

      this.initDOM();
      this.bindControls();

      if (!this.loadState()) {
        this.start();
      } else {
        this.lastDropTime = performance.now();
        this.gameLoop(this.lastDropTime);
      }
    }

    initDOM() {
      this.container.innerHTML = `
        <div class="tetris-wrapper">
          <!-- 顶部子操作栏 -->
          <div class="sheep-sub-header" style="width: 100%; max-width: 360px; border-radius: 8px; margin-bottom: 4px;">
            <button class="sheep-mini-btn" id="tetrisBackBtn" title="返回主页">← 主页</button>
            <span style="color:#fff; font-size:12px; font-weight:bold;">🧱 俄罗斯方块</span>
            <div style="display:flex; gap:6px;">
              <button class="sheep-mini-btn" id="tetrisPauseBtn" title="暂停/继续">⏸</button>
              <button class="sheep-mini-btn" id="tetrisRestartBtn" title="重新开始">🔄</button>
            </div>
          </div>

          <div class="tetris-layout">
            <!-- 左侧面板: Hold & Level -->
            <div class="tetris-sidebar">
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Hold</div>
                <canvas id="tetrisHoldCanvas" class="tetris-preview-canvas" width="48" height="48"></canvas>
              </div>
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Level</div>
                <div class="tetris-panel-val" id="tetrisLevel">1</div>
              </div>
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Lines</div>
                <div class="tetris-panel-val" id="tetrisLines">0</div>
              </div>
            </div>

            <!-- 中间主视窗: Canvas (180 x 360) -->
            <div class="tetris-main-box">
              <canvas id="tetrisCanvas" width="180" height="360"></canvas>
            </div>

            <!-- 右侧面板: Next & Score -->
            <div class="tetris-sidebar">
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Next</div>
                <canvas id="tetrisNextCanvas" class="tetris-preview-canvas" width="48" height="48"></canvas>
              </div>
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Score</div>
                <div class="tetris-panel-val" id="tetrisScore">0</div>
              </div>
            </div>
          </div>

          <!-- 手机虚拟手柄控制器 -->
          <div class="tetris-controls">
            <div class="tetris-ctrl-row">
              <button class="tetris-btn hold" id="btnHold">暂存(C)</button>
              <button class="tetris-btn rotate" id="btnRotate">旋转 ↻</button>
              <button class="tetris-btn drop" id="btnHardDrop">硬降 ⤓</button>
            </div>
            <div class="tetris-ctrl-row">
              <button class="tetris-btn" id="btnLeft">◀ 左移</button>
              <button class="tetris-btn" id="btnDown">▼ 软降</button>
              <button class="tetris-btn" id="btnRight">右移 ▶</button>
            </div>
          </div>

          <!-- 暂停遮罩 -->
          <div class="stgc-pause-mask" id="tetrisPauseMask">
            <div class="stgc-pause-icon">⏸</div>
            <div class="stgc-pause-title">游戏已暂停</div>
            <div class="stgc-pause-hint">点击屏幕任意处继续</div>
          </div>

          <!-- 结算弹窗 -->
          <div class="stgc-alert-overlay" id="tetrisModal">
            <div class="stgc-alert-box">
              <div class="stgc-alert-icon" id="tetrisModalIcon">🧱</div>
              <div class="stgc-alert-title" id="tetrisModalTitle">Game Over</div>
              <div class="stgc-alert-desc" id="tetrisModalDesc">最终得分: 0</div>
              <div class="stgc-alert-btns">
                <button class="stgc-btn-p" id="tetrisModalOk">再来一局</button>
              </div>
            </div>
          </div>
        </div>
      `;

      this.canvas = this.container.querySelector('#tetrisCanvas');
      this.ctx = this.canvas.getContext('2d');

      this.nextCanvas = this.container.querySelector('#tetrisNextCanvas');
      this.nextCtx = this.nextCanvas.getContext('2d');

      this.holdCanvas = this.container.querySelector('#tetrisHoldCanvas');
      this.holdCtx = this.holdCanvas.getContext('2d');

      this.scoreEl = this.container.querySelector('#tetrisScore');
      this.linesEl = this.container.querySelector('#tetrisLines');
      this.levelEl = this.container.querySelector('#tetrisLevel');

      this.pauseMask = this.container.querySelector('#tetrisPauseMask');
      this.pauseBtn = this.container.querySelector('#tetrisPauseBtn');

      this.modalEl = this.container.querySelector('#tetrisModal');
      this.modalTitle = this.container.querySelector('#tetrisModalTitle');
      this.modalDesc = this.container.querySelector('#tetrisModalDesc');
      this.modalOkBtn = this.container.querySelector('#tetrisModalOk');
    }

    bindControls() {
      this.keyHandler = (e) => {
        if (this.isGameOver || this.isPaused) return;
        switch (e.code) {
          case 'ArrowLeft': case 'KeyA':
            this.move(-1); e.preventDefault(); break;
          case 'ArrowRight': case 'KeyD':
            this.move(1); e.preventDefault(); break;
          case 'ArrowDown': case 'KeyS':
            this.drop(); e.preventDefault(); break;
          case 'ArrowUp': case 'KeyW':
            this.rotate(); e.preventDefault(); break;
          case 'Space':
            this.hardDrop(); e.preventDefault(); break;
          case 'KeyC': case 'ShiftLeft': case 'ShiftRight':
            this.hold(); e.preventDefault(); break;
        }
      };
      window.addEventListener('keydown', this.keyHandler);

      const addClick = (id, fn) => {
        const btn = this.container.querySelector(id);
        if (btn) {
          btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (!this.isPaused) fn();
          });
        }
      };

      addClick('#btnLeft', () => this.move(-1));
      addClick('#btnRight', () => this.move(1));
      addClick('#btnDown', () => this.drop());
      addClick('#btnRotate', () => this.rotate());
      addClick('#btnHardDrop', () => this.hardDrop());
      addClick('#btnHold', () => this.hold());

      this.container.querySelector('#tetrisBackBtn').addEventListener('click', () => {
        this.saveState();
        if (this.onBackHome) this.onBackHome();
      });

      this.pauseBtn.addEventListener('click', () => this.togglePause());
      this.pauseMask.addEventListener('click', () => this.togglePause(false));

      this.container.querySelector('#tetrisRestartBtn').addEventListener('click', () => {
        this.clearState();
        this.start();
      });

      this.modalOkBtn.addEventListener('click', () => {
        this.modalEl.classList.remove('active');
        this.clearState();
        this.start();
      });
    }

    togglePause(force) {
      this.isPaused = force !== undefined ? force : !this.isPaused;
      this.pauseMask.classList.toggle('active', this.isPaused);
      this.pauseBtn.textContent = this.isPaused ? '▶' : '⏸';
    }

    destroy() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      window.removeEventListener('keydown', this.keyHandler);
    }

    start() {
      this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.bag = [];
      this.holdPiece = null;
      this.canHold = true;
      this.isGameOver = false;
      this.isPaused = false;
      this.dropInterval = 800;

      this.updateScore(0, 0);
      this.nextPiece = this.popBag();
      this.spawnPiece();

      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.lastDropTime = performance.now();
      this.gameLoop(this.lastDropTime);
    }

    popBag() {
      if (this.bag.length === 0) {
        this.bag = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      const type = this.bag.pop();
      return {
        type,
        color: TETRIS_SHAPES[type].color,
        matrix: TETRIS_SHAPES[type].matrix.map(row => [...row])
      };
    }

    spawnPiece() {
      this.currentPiece = this.nextPiece;
      this.nextPiece = this.popBag();
      this.currentPiece.x = Math.floor((this.cols - this.currentPiece.matrix[0].length) / 2);
      this.currentPiece.y = 0;
      this.canHold = true;

      if (this.collide(this.currentPiece.x, this.currentPiece.y, this.currentPiece.matrix)) {
        this.gameOver();
      }

      this.drawNext();
      this.drawHold();
    }

    collide(offsetX, offsetY, matrix) {
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c]) {
            const newX = offsetX + c;
            const newY = offsetY + r;
            if (newX < 0 || newX >= this.cols || newY >= this.rows) return true;
            if (newY >= 0 && this.board[newY][newX]) return true;
          }
        }
      }
      return false;
    }

    move(dir) {
      if (this.isGameOver || this.isPaused) return;
      if (!this.collide(this.currentPiece.x + dir, this.currentPiece.y, this.currentPiece.matrix)) {
        this.currentPiece.x += dir;
        sound.playTone(300, 'triangle', 0.04);
        this.draw();
      }
    }

    rotate() {
      if (this.isGameOver || this.isPaused) return;
      const m = this.currentPiece.matrix;
      const rotated = m[0].map((_, i) => m.map(row => row[i]).reverse());

      const kicks = [0, -1, 1, -2, 2];
      for (const k of kicks) {
        if (!this.collide(this.currentPiece.x + k, this.currentPiece.y, rotated)) {
          this.currentPiece.x += k;
          this.currentPiece.matrix = rotated;
          sound.playRotate();
          this.draw();
          return;
        }
      }
    }

    drop() {
      if (this.isGameOver || this.isPaused) return;
      if (!this.collide(this.currentPiece.x, this.currentPiece.y + 1, this.currentPiece.matrix)) {
        this.currentPiece.y += 1;
        this.score += 1;
        this.scoreEl.textContent = this.score;
        this.draw();
        return true;
      } else {
        this.lockPiece();
        return false;
      }
    }

    hardDrop() {
      if (this.isGameOver || this.isPaused) return;
      let droppedCells = 0;
      while (!this.collide(this.currentPiece.x, this.currentPiece.y + 1, this.currentPiece.matrix)) {
        this.currentPiece.y += 1;
        droppedCells++;
      }
      this.score += droppedCells * 2;
      this.scoreEl.textContent = this.score;
      sound.playDock();
      this.lockPiece();
    }

    hold() {
      if (this.isGameOver || !this.canHold || this.isPaused) return;
      sound.playTool();
      const currentType = this.currentPiece.type;

      if (!this.holdPiece) {
        this.holdPiece = {
          type: currentType,
          color: TETRIS_SHAPES[currentType].color,
          matrix: TETRIS_SHAPES[currentType].matrix.map(row => [...row])
        };
        this.spawnPiece();
      } else {
        const tempType = this.holdPiece.type;
        this.holdPiece = {
          type: currentType,
          color: TETRIS_SHAPES[currentType].color,
          matrix: TETRIS_SHAPES[currentType].matrix.map(row => [...row])
        };
        this.currentPiece = {
          type: tempType,
          color: TETRIS_SHAPES[tempType].color,
          matrix: TETRIS_SHAPES[tempType].matrix.map(row => [...row]),
          x: Math.floor((this.cols - TETRIS_SHAPES[tempType].matrix[0].length) / 2),
          y: 0
        };
      }
      this.canHold = false;
      this.drawHold();
      this.draw();
      this.saveState();
    }

    lockPiece() {
      const { x, y, matrix, color } = this.currentPiece;
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c]) {
            if (y + r < 0) {
              this.gameOver();
              return;
            }
            this.board[y + r][x + c] = color;
          }
        }
      }

      this.clearLines();
      this.spawnPiece();
      this.draw();
      this.saveState();
    }

    clearLines() {
      let cleared = 0;
      for (let r = this.rows - 1; r >= 0; r--) {
        if (this.board[r].every(cell => cell !== 0)) {
          this.board.splice(r, 1);
          this.board.unshift(Array(this.cols).fill(0));
          cleared++;
          r++;
        }
      }

      if (cleared > 0) {
        if (cleared === 4) sound.playTetrisClear();
        else sound.playLineClear();

        const lineScores = [0, 100, 300, 500, 800];
        const gain = (lineScores[cleared] || 100) * this.level;
        this.updateScore(gain, cleared);
      }
    }

    updateScore(addScore, addLines) {
      this.score += addScore;
      this.lines += addLines;
      this.level = Math.floor(this.lines / 10) + 1;
      this.dropInterval = Math.max(120, 800 - (this.level - 1) * 70);

      this.scoreEl.textContent = this.score;
      this.linesEl.textContent = this.lines;
      this.levelEl.textContent = this.level;
    }

    gameOver() {
      this.isGameOver = true;
      sound.playLose();
      this.clearState();
      this.modalDesc.textContent = `最终得分: ${this.score} | 消除行数: ${this.lines}`;
      this.modalEl.classList.add('active');
    }

    saveState() {
      try {
        if (this.isGameOver) return;
        const data = {
          board: this.board,
          score: this.score,
          lines: this.lines,
          level: this.level,
          currentPiece: this.currentPiece,
          nextPiece: this.nextPiece,
          holdPiece: this.holdPiece
        };
        localStorage.setItem(TETRIS_STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
    }

    loadState() {
      try {
        const raw = localStorage.getItem(TETRIS_STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.board)) return false;

        this.board = data.board;
        this.score = data.score || 0;
        this.lines = data.lines || 0;
        this.level = data.level || 1;
        this.currentPiece = data.currentPiece;
        this.nextPiece = data.nextPiece;
        this.holdPiece = data.holdPiece;

        this.scoreEl.textContent = this.score;
        this.linesEl.textContent = this.lines;
        this.levelEl.textContent = this.level;

        this.drawNext();
        this.drawHold();
        this.draw();
        return true;
      } catch (e) {
        return false;
      }
    }

    clearState() {
      try { localStorage.removeItem(TETRIS_STORAGE_KEY); } catch (e) {}
    }

    gameLoop(timestamp) {
      if (this.isGameOver) return;
      if (!this.isPaused && timestamp - this.lastDropTime > this.dropInterval) {
        this.drop();
        this.lastDropTime = timestamp;
      }
      this.draw();
      this.rafId = requestAnimationFrame((t) => this.gameLoop(t));
    }

    getGhostY() {
      let ghostY = this.currentPiece.y;
      while (!this.collide(this.currentPiece.x, ghostY + 1, this.currentPiece.matrix)) {
        ghostY++;
      }
      return ghostY;
    }

    draw() {
      const bs = this.blockSize;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      this.ctx.lineWidth = 1;
      for (let r = 0; r <= this.rows; r++) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, r * bs);
        this.ctx.lineTo(this.cols * bs, r * bs);
        this.ctx.stroke();
      }
      for (let c = 0; c <= this.cols; c++) {
        this.ctx.beginPath();
        this.ctx.moveTo(c * bs, 0);
        this.ctx.lineTo(c * bs, this.rows * bs);
        this.ctx.stroke();
      }

      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.board[r][c]) {
            this.drawBlock(this.ctx, c * bs, r * bs, bs, this.board[r][c]);
          }
        }
      }

      if (this.currentPiece) {
        const gy = this.getGhostY();
        const m = this.currentPiece.matrix;
        for (let r = 0; r < m.length; r++) {
          for (let c = 0; c < m[r].length; c++) {
            if (m[r][c]) {
              this.drawGhostBlock(this.ctx, (this.currentPiece.x + c) * bs, (gy + r) * bs, bs, this.currentPiece.color);
            }
          }
        }

        for (let r = 0; r < m.length; r++) {
          for (let c = 0; c < m[r].length; c++) {
            if (m[r][c]) {
              this.drawBlock(this.ctx, (this.currentPiece.x + c) * bs, (this.currentPiece.y + r) * bs, bs, this.currentPiece.color);
            }
          }
        }
      }
    }

    drawBlock(ctx, x, y, size, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x + 1, y + 1, size - 2, 2);
      ctx.fillRect(x + 1, y + 1, 2, size - 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(x + size - 3, y + 1, 2, size - 2);
      ctx.fillRect(x + 1, y + size - 3, size - 2, 2);
    }

    drawGhostBlock(ctx, x, y, size, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
    }

    drawPreview(canvas, ctx, piece) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!piece) return;
      const m = piece.matrix;
      const size = 10;
      const offsetX = (canvas.width - m[0].length * size) / 2;
      const offsetY = (canvas.height - m.length * size) / 2;

      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c]) {
            this.drawBlock(ctx, offsetX + c * size, offsetY + r * size, size, piece.color);
          }
        }
      }
    }

    drawNext() { this.drawPreview(this.nextCanvas, this.nextCtx, this.nextPiece); }
    drawHold() { this.drawPreview(this.holdCanvas, this.holdCtx, this.holdPiece); }
  }

  // ================= 4. 全局调度器、主页Hub与酒馆菜单无缝挂载 =================
  class SillyGamePlugin {
    constructor() {
      this.currentView = 'home'; // 'home' | 'sheep' | 'tetris'
      this.sheepInstance = null;
      this.tetrisInstance = null;
      this.launcherVisible = true;

      const savedLauncher = localStorage.getItem(LAUNCHER_HIDDEN_KEY);
      if (savedLauncher === '1') {
        this.launcherVisible = false;
      }

      this.initLauncher();
      this.initModal();
      this.bindShortcuts();
      this.startHeartbeatHooks();
    }

    getViewportSize() {
      return {
        width: Math.max(window.innerWidth || 360, 240),
        height: Math.max(window.innerHeight || 640, 240),
      };
    }

    clampLauncherPosition(x, y) {
      const vp = this.getViewportSize();
      const margin = 8;
      return {
        x: Math.min(Math.max(x, margin), vp.width - 56 - margin),
        y: Math.min(Math.max(y, margin), vp.height - 56 - margin),
      };
    }

    setLauncherPosition(x, y, save = true) {
      const launcher = document.getElementById(`${PLUGIN_ID}-launcher`);
      if (!launcher) return;
      const pos = this.clampLauncherPosition(x, y);
      launcher.style.left = `${pos.x}px`;
      launcher.style.top = `${pos.y}px`;
      launcher.style.right = 'auto';
      launcher.style.bottom = 'auto';
      if (save) {
        try { localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(pos)); } catch (e) {}
      }
    }

    resetLauncherPosition() {
      const vp = this.getViewportSize();
      // 默认安全落位在右侧，避开底部输入框
      this.setLauncherPosition(vp.width - 64, vp.height - 150, true);
    }

    initLauncher() {
      if (document.getElementById(`${PLUGIN_ID}-launcher`)) return;

      const launcher = document.createElement('div');
      launcher.id = `${PLUGIN_ID}-launcher`;
      launcher.className = `stgc-launcher ${this.launcherVisible ? '' : 'is-hidden'}`;
      launcher.title = '打开小游戏中心 (Alt+G)';
      launcher.innerHTML = `
        <svg class="stgc-launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17 17l-3-3H10l-3 3-3-2V8a4 4 0 014-4h8a4 4 0 014 4v7l-3 2z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      // 备用召回浮条
      const restore = document.createElement('div');
      restore.id = `${PLUGIN_ID}-restore`;
      restore.className = `stgc-restore-handle ${this.launcherVisible ? '' : 'show'}`;
      restore.title = '唤醒 SheepBlock 游戏悬浮球';
      restore.textContent = '🎮';
      restore.addEventListener('click', () => this.setLauncherVisible(true));

      // 拖拽逻辑
      let drag = null;
      launcher.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const rect = launcher.getBoundingClientRect();
        drag = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          originX: rect.left,
          originY: rect.top,
          moved: false
        };
        launcher.setPointerCapture?.(e.pointerId);
      });

      launcher.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 6) return;
        drag.moved = true;
        this.setLauncherPosition(drag.originX + dx, drag.originY + dy, false);
      });

      const endDrag = (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const moved = drag.moved;
        drag = null;
        if (moved) {
          const rect = launcher.getBoundingClientRect();
          this.setLauncherPosition(rect.left, rect.top, true);
        } else {
          this.openModal();
        }
      };

      launcher.addEventListener('pointerup', endDrag);
      launcher.addEventListener('pointercancel', () => { drag = null; });

      document.body.append(launcher, restore);

      // 计算初始落位
      const saved = localStorage.getItem(LAUNCHER_POS_KEY);
      if (saved) {
        try {
          const pos = JSON.parse(saved);
          this.setLauncherPosition(pos.x, pos.y, false);
        } catch (e) {
          requestAnimationFrame(() => this.resetLauncherPosition());
        }
      } else {
        requestAnimationFrame(() => this.resetLauncherPosition());
      }
    }

    setLauncherVisible(visible) {
      this.launcherVisible = visible;
      localStorage.setItem(LAUNCHER_HIDDEN_KEY, visible ? '0' : '1');
      const launcher = document.getElementById(`${PLUGIN_ID}-launcher`);
      const restore = document.getElementById(`${PLUGIN_ID}-restore`);
      if (launcher) launcher.classList.toggle('is-hidden', !visible);
      if (restore) restore.classList.toggle('show', !visible);

      const cb = document.getElementById('stgcToggleLauncherCb');
      if (cb) cb.checked = visible;
    }

    initModal() {
      if (document.getElementById(`${PLUGIN_ID}-modal`)) return;

      const mask = document.createElement('div');
      mask.id = `${PLUGIN_ID}-modal`;
      mask.className = 'stgc-modal-mask';

      mask.innerHTML = `
        <div class="stgc-window" id="${PLUGIN_ID}-win">
          <header class="stgc-header" id="stgcMainHeader">
            <div class="stgc-header-title">
              <span>🎮 SheepBlock 游戏中心</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="stgc-header-btn close" id="stgcCloseBtn" title="关闭 (Esc)">✕</button>
            </div>
          </header>
          <div class="stgc-body" id="stgcMainBody"></div>
        </div>
      `;

      mask.addEventListener('click', (e) => {
        if (e.target === mask) this.closeModal();
      });

      document.body.appendChild(mask);
      this.mask = mask;
      this.win = mask.querySelector(`#${PLUGIN_ID}-win`);
      this.body = mask.querySelector('#stgcMainBody');

      mask.querySelector('#stgcCloseBtn').addEventListener('click', () => this.closeModal());
    }

    renderHome() {
      this.currentView = 'home';
      document.getElementById('stgcMainHeader').style.display = 'flex';
      this.body.innerHTML = `
        <div class="stgc-home-view">
          <div class="stgc-home-intro">
            <div class="stgc-home-title">随手玩一局，不打扰聊天</div>
            <div class="stgc-home-desc">专为 SillyTavern 打造的休闲解压游戏合集</div>
          </div>

          <div class="stgc-game-grid">
            <!-- 羊了个羊卡片 -->
            <div class="stgc-game-card" id="cardGoSheep">
              <div class="stgc-card-icon-box sheep">🐑</div>
              <div class="stgc-card-info">
                <div class="stgc-card-top-row">
                  <div class="stgc-card-title">羊了个羊</div>
                  <span class="stgc-card-badge">爽玩版</span>
                </div>
                <div class="stgc-card-desc">
                  经典多层堆叠三消 · 道具初始各5次 · 5格暂存区 · 无限补给杜绝死局
                </div>
              </div>
              <div class="stgc-card-arrow">›</div>
            </div>

            <!-- 俄罗斯方块卡片 -->
            <div class="stgc-game-card" id="cardGoTetris">
              <div class="stgc-card-icon-box tetris">🧱</div>
              <div class="stgc-card-info">
                <div class="stgc-card-top-row">
                  <div class="stgc-card-title">俄罗斯方块</div>
                  <span class="stgc-card-badge">现代竞技</span>
                </div>
                <div class="stgc-card-desc">
                  官方 7-Bag 均匀发牌 · 幽灵落点投影 · Hold 换块暂存 · 手机专属虚拟手柄
                </div>
              </div>
              <div class="stgc-card-arrow">›</div>
            </div>
          </div>
        </div>
      `;

      this.body.querySelector('#cardGoSheep').addEventListener('click', () => this.launchSheep());
      this.body.querySelector('#cardGoTetris').addEventListener('click', () => this.launchTetris());
    }

    launchSheep() {
      this.currentView = 'sheep';
      document.getElementById('stgcMainHeader').style.display = 'none'; // 使用羊了个羊专属顶部子栏
      this.body.innerHTML = '<div id="sheepRoot" style="height:100%; display:flex; flex-direction:column;"></div>';
      const root = this.body.querySelector('#sheepRoot');
      this.sheepInstance = new SheepEngine(root, () => this.renderHome());
    }

    launchTetris() {
      this.currentView = 'tetris';
      document.getElementById('stgcMainHeader').style.display = 'none'; // 使用俄罗斯方块专属顶部子栏
      this.body.innerHTML = '<div id="tetrisRoot" style="height:100%; display:flex; flex-direction:column;"></div>';
      const root = this.body.querySelector('#tetrisRoot');
      this.tetrisInstance = new TetrisEngine(root, () => this.renderHome());
    }

    openModal() {
      this.mask.classList.add('show');
      if (this.currentView === 'home') {
        this.renderHome();
      }
    }

    closeModal() {
      if (this.sheepInstance) this.sheepInstance.saveState();
      if (this.tetrisInstance) {
        this.tetrisInstance.saveState();
        this.tetrisInstance.destroy();
        this.tetrisInstance = null;
      }
      this.mask.classList.remove('show');
    }

    bindShortcuts() {
      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'g' || e.key === 'G')) {
          e.preventDefault();
          if (this.mask.classList.contains('show')) this.closeModal();
          else this.openModal();
        } else if (e.key === 'Escape' && this.mask?.classList.contains('show')) {
          this.closeModal();
        }
      });
    }

    // ================= 5. 酒馆原生界面联动 (设置抽屉 + 魔法棒菜单) =================
    startHeartbeatHooks() {
      // 周期性检查与挂载，抵抗酒馆切角色或动态DOM重建
      setInterval(() => {
        this.injectSettingsDrawer();
        this.injectExtensionsMenuButton();
        this.ensureLauncherAlive();
      }, 1000);
    }

    ensureLauncherAlive() {
      if (!document.getElementById(`${PLUGIN_ID}-launcher`)) {
        this.initLauncher();
      }
    }

    // 注入酒馆设置面板
    injectSettingsDrawer() {
      const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
      if (container && !document.getElementById('st-sheepblock-settings')) {
        const card = document.createElement('div');
        card.id = 'st-sheepblock-settings';
        card.className = 'stgc-settings-card';
        card.innerHTML = `
          <div class="stgc-settings-card-title">🎮 SillyTavern SheepBlock (小游戏中心)</div>
          <button type="button" class="stgc-settings-open-btn" id="stgcOpenDirectBtn">
            🎮 启动游戏中心 (羊了个羊 & 俄罗斯方块)
          </button>
          <label style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12px; color:#cbd5e1; cursor:pointer;">
            <input type="checkbox" id="stgcToggleLauncherCb" ${this.launcherVisible ? 'checked' : ''}>
            <span>在屏幕上显示浮动手柄悬浮球</span>
          </label>
        `;
        container.appendChild(card);

        card.querySelector('#stgcOpenDirectBtn').addEventListener('click', () => {
          this.openModal();
        });

        card.querySelector('#stgcToggleLauncherCb').addEventListener('change', (e) => {
          this.setLauncherVisible(e.target.checked);
        });
      }
    }

    // 完美注入图片 4 中的酒馆原生扩展菜单 (Extensions Context Menu)
    injectExtensionsMenuButton() {
      // 探测酒馆不同版本下的扩展菜单容器
      const menuContainer = document.getElementById('extensions_menu') || document.querySelector('.extensions_menu');
      if (menuContainer && !document.getElementById('st_sheepblock_menu_entry')) {
        const item = document.createElement('div');
        item.id = 'st_sheepblock_menu_entry';
        item.className = 'list-group-item extension_menu_button';
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.innerHTML = `
          <span style="font-size:16px;">🎮</span>
          <span>SheepBlock 小游戏</span>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          // 关闭当前下拉菜单
          if (menuContainer) menuContainer.style.display = 'none';
          this.openModal();
        });
        menuContainer.appendChild(item);
      }
    }
  }

  // 全局暴露与开箱自启
  window.openSheepBlock = () => window.sillyGamePlus?.openModal();

  function init() {
    window.sillyGamePlus = new SillyGamePlugin();
    console.log('[SillyTavern SheepBlock] 升级版全功能游戏中心已挂载就绪！');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
