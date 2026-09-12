# Silly Game Plus (酒馆小游戏扩展：羊了个羊 & 俄罗斯方块)

专为 **SillyTavern（酒馆）** 打造的沉浸式前端小游戏扩展插件，参考 [Silly-Game](https://github.com/akari-taomini/Silly-Game.git) 交互规范实现。

---

## 包含游戏

1. 🐑 **羊了个羊（爽玩增强版）**
   - 经典 AABB 分层遮挡与多层金字塔大堆消除。
   - **道具超级扩容**：初始各提供 5 次移出、5 次撤销、5 次洗牌。
   - **无限补充**：一键“+3 道具”随心补满，告别死局！
   - **大容量暂存区**：支持最多暂存 5 张卡牌周转。
   - 内置程序化 Web Audio 治愈音效。

2. 🧱 **现代俄罗斯方块（Tetris）**
   - **7-Bag 竞技级随机系统**：杜绝连卡恶性发牌。
   - **幽灵投影（Ghost Piece）**：实时预见落点。
   - **Hold 暂存机制** 与 **Next 方块预览**。
   - **全端操控适配**：电脑端键盘方向键与空格硬降，手机触屏提供全功能虚拟手柄。

---

## 安装使用指南

### 方式一：安装至 SillyTavern（酒馆）插件目录

1. 将整个 `silly_tavern_game_plugin` 文件夹复制到您的 SillyTavern 安装目录下的第三方扩展目录：
   ```
   SillyTavern/public/scripts/extensions/third-party/silly-game-plus/
   ```
2. 启动或刷新 SillyTavern 页面。
3. 页面右下角将出现可拖拽的游戏手柄**悬浮球（Launcher）**。
4. 点击悬浮球，或在键盘上按下快捷键 **`Alt + G`**，即可呼出游戏中心！

### 方式二：本地免酒馆直接玩

无需启动任何服务器，直接在文件资源管理器中双击打开 `index.html` 即可畅玩全部游戏！
