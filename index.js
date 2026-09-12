/**
 * Silly Game Plus - SillyTavern 专属小游戏扩展插件
 * 包含：
 * 1. 🐑 羊了个羊 (爽玩增强版：道具5次+无限补充+5格暂存区)
 * 2. 🧱 现代俄罗斯方块 (7-Bag 发牌 + 幽灵投影 + Hold暂存 + 触屏虚拟手柄)
 */

(() => {
  'use strict';

  const PLUGIN_ID = 'silly-game-plus';
  const LAUNCHER_POS_KEY = 'st-game-plus-launcher-pos';

  // ================= 1. 程序化音频合成引擎 (零外部文件) =================
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      } catch (e) {
        console.warn('AudioContext 初始化跳过:', e);
      }
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
    constructor(container) {
      this.container = container;
      this.currentLevel = 1;
      this.allCards = [];
      this.dockList = [];
      this.holdingList = [];
      this.historyStack = [];
      this.isAnimating = false;
      this.hasRevived = false;

      // 超级扩充道具：初始各 5 次
      this.toolsCount = { moveOut: 5, undo: 5, shuffle: 5 };

      this.initDOM();
      this.bindEvents();
      this.startLevel(1);
    }

    initDOM() {
      this.container.innerHTML = `
        <div class="sheep-wrapper">
          <div class="sheep-sub-header">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sheep-badge" id="sheepLevelBadge">第 1 关</span>
              <span class="sheep-remain">剩余: <b id="sheepRemain">0</b></span>
            </div>
            <div class="sheep-actions-top">
              <button class="sheep-mini-btn supply" id="sheepSupplyBtn" title="补充全部道具+3次">⚡ 补给(+3)</button>
              <button class="sheep-mini-btn" id="sheepRestartBtn" title="重新开始本关">🔄</button>
            </div>
          </div>

          <!-- 5格大容量暂存区 -->
          <div class="sheep-holding">
            <div class="sheep-holding-label">暂存区 (最多5格，可随时点击收回)</div>
            <div class="sheep-holding-slots" id="sheepHoldingSlots"></div>
          </div>

          <!-- 卡牌主舞台 -->
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

          <!-- 道具栏 -->
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

      // 绑定元素
      this.stageEl = this.container.querySelector('#sheepStage');
      this.dockContainer = this.container.querySelector('#sheepDockCards');
      this.holdingSlots = this.container.querySelector('#sheepHoldingSlots');
      this.remainEl = this.container.querySelector('#sheepRemain');
      this.levelBadge = this.container.querySelector('#sheepLevelBadge');

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
      this.container.querySelector('#sheepRestartBtn').addEventListener('click', () => {
        this.startLevel(this.currentLevel);
      });

      this.container.querySelector('#sheepSupplyBtn').addEventListener('click', () => {
        this.toolsCount.moveOut += 3;
        this.toolsCount.undo += 3;
        this.toolsCount.shuffle += 3;
        sound.playTool();
        this.updateToolsUI();
      });

      this.toolMoveBtn.addEventListener('click', () => this.useToolMoveOut());
      this.toolUndoBtn.addEventListener('click', () => this.useToolUndo());
      this.toolShuffleBtn.addEventListener('click', () => this.useToolShuffle());

      this.modalOkBtn.addEventListener('click', () => {
        this.modalEl.classList.remove('active');
        if (this.modalOkBtn.dataset.action === 'next') {
          this.startLevel(2);
        } else {
          this.startLevel(this.currentLevel);
        }
      });

      this.modalReviveBtn.addEventListener('click', () => {
        this.modalEl.classList.remove('active');
        this.revive();
      });
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
      this.updateCoveredStatus();
      this.updateRemain();
      this.updateToolsUI();
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
        { x: 45, y: 65, z: 0 }, { x: 155, y: 65, z: 0 }, { x: 265, y: 65, z: 0 },
        { x: 45, y: 170, z: 0 }, { x: 155, y: 170, z: 0 }, { x: 265, y: 170, z: 0 },
        { x: 45, y: 275, z: 0 }, { x: 155, y: 275, z: 0 }, { x: 265, y: 275, z: 0 },
        { x: 100, y: 115, z: 1 }, { x: 210, y: 115, z: 1 }, { x: 100, y: 225, z: 1 },
        { x: 210, y: 225, z: 1 }, { x: 155, y: 170, z: 1 },
        { x: 130, y: 140, z: 2 }, { x: 180, y: 140, z: 2 }, { x: 130, y: 200, z: 2 }, { x: 180, y: 200, z: 2 },
      ];

      this.allCards = cardPool.map((item, idx) => ({
        id: `sheep_${idx}`,
        type: item.type,
        icon: item.icon,
        name: item.name,
        x: positions[idx].x,
        y: positions[idx].y,
        z: positions[idx].z,
        width: 48,
        height: 52,
        state: 'stage',
        isCovered: false,
        el: null
      }));
    }

    generateLevel2() {
      const positions = [];
      // 0~5 层交错大金字塔
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (Math.random() > 0.15) positions.push({ x: 62 + c * 48, y: 55 + r * 54, z: 0 });
        }
      }
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (Math.random() > 0.1) positions.push({ x: 86 + c * 48, y: 82 + r * 54, z: 1 });
        }
      }
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) positions.push({ x: 110 + c * 48, y: 109 + r * 54, z: 2 });
      }
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) positions.push({ x: 134 + c * 48, y: 136 + r * 54, z: 3 });
      }
      positions.push({ x: 158, y: 160, z: 4 });

      // 两翼暗牌堆
      for (let i = 0; i < 8; i++) positions.push({ x: 10, y: 75 + i * 5, z: 10 + i });
      for (let i = 0; i < 8; i++) positions.push({ x: 302, y: 75 + i * 5, z: 10 + i });
      // 底部备用牌
      for (let i = 0; i < 4; i++) positions.push({ x: 70 + i * 58, y: 350, z: 1 });

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
        width: 48,
        height: 52,
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
            if (card.state === 'stage' || card.state === 'holding') {
              this.handleCardClick(card);
            }
          });
          card.el = el;
          this.stageEl.appendChild(el);
        }
      });
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
      if (this.isAnimating) return;
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
      // 自动聚拢相同图案
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
    constructor(container) {
      this.container = container;
      this.cols = 10;
      this.rows = 20;
      this.blockSize = 18; // Canvas 绘图单元格像素尺寸

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
      this.start();
    }

    initDOM() {
      this.container.innerHTML = `
        <div class="tetris-wrapper">
          <div class="tetris-layout">
            <!-- 左侧面板: Hold & Level -->
            <div class="tetris-sidebar">
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Hold</div>
                <canvas id="tetrisHoldCanvas" class="tetris-preview-canvas" width="60" height="60"></canvas>
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
                <canvas id="tetrisNextCanvas" class="tetris-preview-canvas" width="60" height="60"></canvas>
              </div>
              <div class="tetris-panel-box">
                <div class="tetris-panel-title">Score</div>
                <div class="tetris-panel-val" id="tetrisScore">0</div>
              </div>
              <div class="tetris-panel-box" style="padding: 4px;">
                <button class="sheep-mini-btn" id="tetrisRestartBtn" style="width: 100%;">🔄 重开</button>
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

      this.modalEl = this.container.querySelector('#tetrisModal');
      this.modalTitle = this.container.querySelector('#tetrisModalTitle');
      this.modalDesc = this.container.querySelector('#tetrisModalDesc');
      this.modalOkBtn = this.container.querySelector('#tetrisModalOk');
    }

    bindControls() {
      // 键盘操控
      this.keyHandler = (e) => {
        if (this.isGameOver) return;
        switch (e.code) {
          case 'ArrowLeft':
          case 'KeyA':
            this.move(-1);
            e.preventDefault();
            break;
          case 'ArrowRight':
          case 'KeyD':
            this.move(1);
            e.preventDefault();
            break;
          case 'ArrowDown':
          case 'KeyS':
            this.drop();
            e.preventDefault();
            break;
          case 'ArrowUp':
          case 'KeyW':
            this.rotate();
            e.preventDefault();
            break;
          case 'Space':
            this.hardDrop();
            e.preventDefault();
            break;
          case 'KeyC':
          case 'ShiftLeft':
          case 'ShiftRight':
            this.hold();
            e.preventDefault();
            break;
        }
      };
      window.addEventListener('keydown', this.keyHandler);

      // 虚拟按键操控
      const addClick = (id, fn) => {
        const btn = this.container.querySelector(id);
        if (btn) {
          btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            fn();
          });
        }
      };

      addClick('#btnLeft', () => this.move(-1));
      addClick('#btnRight', () => this.move(1));
      addClick('#btnDown', () => this.drop());
      addClick('#btnRotate', () => this.rotate());
      addClick('#btnHardDrop', () => this.hardDrop());
      addClick('#btnHold', () => this.hold());

      this.container.querySelector('#tetrisRestartBtn').addEventListener('click', () => this.start());
      this.modalOkBtn.addEventListener('click', () => {
        this.modalEl.classList.remove('active');
        this.start();
      });
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
      this.dropInterval = 800;

      this.updateScore(0, 0);
      this.nextPiece = this.popBag();
      this.spawnPiece();

      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.lastDropTime = performance.now();
      this.gameLoop(this.lastDropTime);
    }

    // 7-Bag 随机发牌
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

      // 生成时碰撞即游戏失败
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
      if (this.isGameOver) return;
      if (!this.collide(this.currentPiece.x + dir, this.currentPiece.y, this.currentPiece.matrix)) {
        this.currentPiece.x += dir;
        sound.playTone(300, 'triangle', 0.04);
        this.draw();
      }
    }

    rotate() {
      if (this.isGameOver) return;
      const m = this.currentPiece.matrix;
      // 矩阵顺时针旋转
      const rotated = m[0].map((_, i) => m.map(row => row[i]).reverse());

      // 简单踢墙检测
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
      if (this.isGameOver) return;
      if (!this.collide(this.currentPiece.x, this.currentPiece.y + 1, this.currentPiece.matrix)) {
        this.currentPiece.y += 1;
        this.score += 1; // 软降加分
        this.scoreEl.textContent = this.score;
        this.draw();
        return true;
      } else {
        this.lockPiece();
        return false;
      }
    }

    hardDrop() {
      if (this.isGameOver) return;
      let droppedCells = 0;
      while (!this.collide(this.currentPiece.x, this.currentPiece.y + 1, this.currentPiece.matrix)) {
        this.currentPiece.y += 1;
        droppedCells++;
      }
      this.score += droppedCells * 2; // 硬降奖励分
      this.scoreEl.textContent = this.score;
      sound.playDock();
      this.lockPiece();
    }

    hold() {
      if (this.isGameOver || !this.canHold) return;
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
    }

    clearLines() {
      let cleared = 0;
      for (let r = this.rows - 1; r >= 0; r--) {
        if (this.board[r].every(cell => cell !== 0)) {
          this.board.splice(r, 1);
          this.board.unshift(Array(this.cols).fill(0));
          cleared++;
          r++; // 重新检测当前行
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
      this.modalDesc.textContent = `最终得分: ${this.score} | 消除行数: ${this.lines}`;
      this.modalEl.classList.add('active');
    }

    gameLoop(timestamp) {
      if (this.isGameOver) return;
      if (timestamp - this.lastDropTime > this.dropInterval) {
        this.drop();
        this.lastDropTime = timestamp;
      }
      this.draw();
      this.rafId = requestAnimationFrame((t) => this.gameLoop(t));
    }

    // 幽灵阴影计算
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

      // 绘制背景微弱网格
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

      // 绘制固定棋盘方块
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.board[r][c]) {
            this.drawBlock(this.ctx, c * bs, r * bs, bs, this.board[r][c]);
          }
        }
      }

      // 绘制幽灵投影方块 (Ghost Piece)
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

        // 绘制当前正在下落的方块
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

      // 高光边框质感
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
      const size = 12;
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

  // ================= 4. SillyTavern 插件全局路由与悬浮球管理 =================
  class SillyGamePlugin {
    constructor() {
      this.activeGame = 'sheep'; // 'sheep' | 'tetris'
      this.sheepInstance = null;
      this.tetrisInstance = null;

      this.initLauncher();
      this.initModal();
      this.bindShortcuts();
    }

    initLauncher() {
      if (document.getElementById(`${PLUGIN_ID}-launcher`)) return;

      const launcher = document.createElement('div');
      launcher.id = `${PLUGIN_ID}-launcher`;
      launcher.className = 'stgc-launcher';
      launcher.title = '打开小游戏中心 (Alt+G)';
      launcher.innerHTML = `
        <svg class="stgc-launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17 17l-3-3H10l-3 3-3-2V8a4 4 0 014-4h8a4 4 0 014 4v7l-3 2z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;

      // 恢复历史位置
      const savedPos = localStorage.getItem(LAUNCHER_POS_KEY);
      if (savedPos) {
        try {
          const { x, y } = JSON.parse(savedPos);
          launcher.style.left = `${x}px`;
          launcher.style.top = `${y}px`;
          launcher.style.right = 'auto';
          launcher.style.bottom = 'auto';
        } catch (e) {}
      }

      // 拖拽逻辑
      let isDragging = false;
      let startX = 0, startY = 0;
      let initLeft = 0, initTop = 0;
      let hasMoved = false;

      const onPointerDown = (e) => {
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = launcher.getBoundingClientRect();
        initLeft = rect.left;
        initTop = rect.top;
        launcher.setPointerCapture?.(e.pointerId);
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.hypot(dx, dy) > 4) hasMoved = true;

        let curX = Math.max(10, Math.min(window.innerWidth - 62, initLeft + dx));
        let curY = Math.max(10, Math.min(window.innerHeight - 62, initTop + dy));

        launcher.style.left = `${curX}px`;
        launcher.style.top = `${curY}px`;
        launcher.style.right = 'auto';
        launcher.style.bottom = 'auto';
      };

      const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        launcher.releasePointerCapture?.(e.pointerId);

        if (hasMoved) {
          const rect = launcher.getBoundingClientRect();
          localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
        } else {
          this.toggleModal();
        }
      };

      launcher.addEventListener('pointerdown', onPointerDown);
      launcher.addEventListener('pointermove', onPointerMove);
      launcher.addEventListener('pointerup', onPointerUp);

      document.body.appendChild(launcher);
    }

    initModal() {
      if (document.getElementById(`${PLUGIN_ID}-modal`)) return;

      const mask = document.createElement('div');
      mask.id = `${PLUGIN_ID}-modal`;
      mask.className = 'stgc-modal-mask';

      mask.innerHTML = `
        <div class="stgc-window" id="${PLUGIN_ID}-win">
          <header class="stgc-header">
            <div class="stgc-header-left">
              <span>🎮 Silly Game Plus</span>
            </div>
            <div class="stgc-tabs">
              <button class="stgc-tab-btn active" data-game="sheep">🐑 羊了个羊</button>
              <button class="stgc-tab-btn" data-game="tetris">🧱 俄罗斯方块</button>
            </div>
            <div class="stgc-header-right">
              <button class="stgc-ctrl-btn" id="stgcFullscreenBtn" title="全屏切换">⛶</button>
              <button class="stgc-ctrl-btn close" id="stgcCloseBtn" title="关闭 (Esc)">✕</button>
            </div>
          </header>
          <div class="stgc-body">
            <div class="stgc-game-view active" id="viewSheep"></div>
            <div class="stgc-game-view" id="viewTetris"></div>
          </div>
        </div>
      `;

      // 遮罩点击关闭
      mask.addEventListener('click', (e) => {
        if (e.target === mask) this.closeModal();
      });

      document.body.appendChild(mask);
      this.mask = mask;
      this.win = mask.querySelector(`#${PLUGIN_ID}-win`);

      // Tabs 切换
      const tabBtns = mask.querySelectorAll('.stgc-tab-btn');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.switchGame(btn.dataset.game);
        });
      });

      // 关闭与全屏
      mask.querySelector('#stgcCloseBtn').addEventListener('click', () => this.closeModal());
      mask.querySelector('#stgcFullscreenBtn').addEventListener('click', () => {
        this.win.classList.toggle('fullscreen');
      });
    }

    bindShortcuts() {
      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'g' || e.key === 'G')) {
          e.preventDefault();
          this.toggleModal();
        } else if (e.key === 'Escape' && this.mask?.classList.contains('show')) {
          this.closeModal();
        }
      });
    }

    toggleModal() {
      if (this.mask.classList.contains('show')) {
        this.closeModal();
      } else {
        this.openModal();
      }
    }

    openModal() {
      this.mask.classList.add('show');
      this.switchGame(this.activeGame);
    }

    closeModal() {
      this.mask.classList.remove('show');
      if (this.tetrisInstance) {
        this.tetrisInstance.destroy();
        this.tetrisInstance = null;
      }
    }

    switchGame(gameKey) {
      this.activeGame = gameKey;
      const viewSheep = document.getElementById('viewSheep');
      const viewTetris = document.getElementById('viewTetris');

      if (gameKey === 'sheep') {
        viewSheep.classList.add('active');
        viewTetris.classList.remove('active');
        if (this.tetrisInstance) {
          this.tetrisInstance.destroy();
          this.tetrisInstance = null;
        }
        if (!this.sheepInstance) {
          this.sheepInstance = new SheepEngine(viewSheep);
        }
      } else if (gameKey === 'tetris') {
        viewTetris.classList.add('active');
        viewSheep.classList.remove('active');
        if (!this.tetrisInstance) {
          this.tetrisInstance = new TetrisEngine(viewTetris);
        }
      }
    }
  }

  // 初始化扩展
  function init() {
    window.sillyGamePlus = new SillyGamePlugin();
    console.log('[Silly Game Plus] 酒馆小游戏插件成功挂载！');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
