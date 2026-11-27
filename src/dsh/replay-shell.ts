// 上课回放和斗地主回放共用的部分：底部字幕和控制器、播放的节奏、键盘、#步数、整页的外壳。两边长得一样、用法一样。
// - 控制器：回到开头、上一步、播放/暂停、下一步、速度（0.5×～4×）、"长句多停"、进度条、"第几步 / 共几步"和这一步停几秒。
// - 节奏：一步默认 3 秒；"长句多停"开着时，字多的按大约每秒 8 个字多停，最多 30 秒（都是 1× 的时间）。
// - 键盘：空格播放/暂停，← → 上一步、下一步。地址后面加 #步数（从 1 数）直接停在那一步。
// - 形象：数据里带 art（见 avatar-look.ts）时，头像画成底色圆、边框加形象图（data: 地址，页面里自带），自家的再加一圈光环；
//   没带（旧记录）就照旧是名字第一个字。
// - 页面不连外网（CSP default-src 'none'，图只认 data:），数据放在 <script type="application/json"> 里，< 换成 <。

export const SHELL_CSS = `
* { box-sizing:border-box; }
html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
#app { display:flex; flex-direction:column; height:100%; }
@keyframes glow { 0%,100% { box-shadow:0 0 0 3px #fff, 0 0 0 7px var(--hl), 0 0 14px 4px var(--hl); } 50% { box-shadow:0 0 0 3px #fff, 0 0 0 9px var(--hl), 0 0 30px 12px var(--hl); } }
@keyframes popside { from { opacity:0; transform:translateX(-8px) scale(.94); } to { opacity:1; transform:none; } }
@keyframes pop { from { opacity:0; transform:translateX(-50%) translateY(8px) scale(.92); } to { opacity:1; transform:translateX(-50%) translateY(0) scale(1); } }
#caption { background:#fff; border-top:1px solid #ddd; padding:10px 18px; height:120px; flex:none; overflow:auto; white-space:pre-wrap; }
#caption .who { font-weight:600; margin-right:6px; }
#caption .tag { color:var(--muted); font-size:12px; margin-right:6px; }
#caption .blocked { color:#a33; font-size:13px; display:block; }
#controls { display:flex; align-items:center; gap:12px; padding:8px 16px; background:#262626; color:#eee; flex-wrap:wrap; }
#controls .group { display:flex; align-items:center; gap:6px; }
#controls button { display:flex; align-items:center; justify-content:center; width:38px; height:34px; background:#3a3a3a; color:#fff; border:0; border-radius:8px; cursor:pointer; padding:0; }
#controls button:hover { background:#4a4a4a; }
#controls button svg { width:18px; height:18px; fill:currentColor; }
#controls button#play { width:46px; height:40px; border-radius:20px; background:#e0782f; }
#controls button#play:hover { background:#ee8a43; }
#controls button#play svg { width:20px; height:20px; }
#controls select { background:#3a3a3a; color:#fff; border:0; border-radius:8px; height:34px; padding:0 8px; font-size:13px; }
#controls label { font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
#controls label input { accent-color:#e0782f; width:16px; height:16px; }
#progress { flex:1; min-width:140px; accent-color:#e0782f; }
#count { text-align:right; font-variant-numeric:tabular-nums; font-size:13px; line-height:1.25; min-width:84px; }
#count small { color:#aaa; display:block; font-size:11px; }
.avatar.pic { overflow:hidden; padding:0; }
.avatar.pic img { width:100%; height:100%; display:block; pointer-events:none; }
.self .avatar.pic { box-shadow:0 0 0 var(--ringw, 4px) var(--ring, #FDE047), 0 0 14px 6px var(--glow, transparent); }
@media (prefers-reduced-motion: reduce) { *, *::after { animation:none !important; transition:none !important; } }
`

const CONTROLS_HTML = `  <div id="caption"></div>
  <div id="controls">
    <div class="group">
      <button id="first" title="回到开头" aria-label="回到开头"><svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg></button>
      <button id="prev" title="上一步（←）" aria-label="上一步"><svg viewBox="0 0 24 24"><path d="M12 5v14L3 12zM21 5v14l-9-7z"/></svg></button>
      <button id="play" title="播放/暂停（空格）" aria-label="播放/暂停"></button>
      <button id="next" title="下一步（→）" aria-label="下一步"><svg viewBox="0 0 24 24"><path d="M3 5v14l9-7zM12 5v14l9-7z"/></svg></button>
    </div>
    <select id="speed" title="播放速度" aria-label="播放速度">
      <option value="0.5">0.5×</option>
      <option value="0.75">0.75×</option>
      <option value="1" selected>1×</option>
      <option value="1.5">1.5×</option>
      <option value="2">2×</option>
      <option value="4">4×</option>
    </select>
    <label title="开着：短的一步停 3 秒，字多的按大约每秒 8 个字多停，最多 30 秒；关着：每步都停 3 秒（都是 1× 的时间）"><input id="pace" type="checkbox" checked>长句多停</label>
    <input id="progress" type="range" min="0" value="0" aria-label="进度">
    <span id="count"></span>
  </div>`

/**
 * 播放器：startPlayer({ count, text(k), show(k), onFirst?, empty })。show(k) 由页面画第 k 步（-1 是还没开始）；
 * text(k) 是第 k 步的字（算停多久用）。播放器管进度、步数、速度、节奏、键盘和 #步数。
 */
const PLAYER_JS = `
// 头像：art 里有这个人就画形象（底色、边框、图），没有就是一个字。自家光环的颜色放进 CSS 变量。
var art = (function () { try { return JSON.parse(document.getElementById('replay-data').textContent).art || null; } catch (e) { return null; } })();
if (art && art.self) {
  var rootStyle = document.documentElement.style;
  rootStyle.setProperty('--ring', art.self.ring);
  rootStyle.setProperty('--ringw', art.self.ringWidth + 'px');
  if (art.self.glow) rootStyle.setProperty('--glow', art.self.glow);
}
function face(key, text) {
  var d = document.createElement('div');
  d.className = 'avatar';
  var f = art && art.faces[key];
  var src = f && art.images[f.img];
  if (!src) { d.textContent = text; return d; }
  d.className = 'avatar pic';
  d.style.background = f.bg;
  d.style.borderColor = f.border;
  var img = document.createElement('img');
  img.src = src;
  img.alt = '';
  d.appendChild(img);
  return d;
}
function startPlayer(o) {
  var progress = document.getElementById('progress');
  var count = document.getElementById('count');
  var playBtn = document.getElementById('play');
  var speedSel = document.getElementById('speed');
  var paceBox = document.getElementById('pace');
  var caption = document.getElementById('caption');
  var BASE_MS = 3000, CHARS_PER_S = 8, MAX_MS = 30000;
  var PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  var n = o.count, i = -1, playing = true, timer = null;
  progress.max = Math.max(0, n - 1);
  function stepMs(k) {
    if (!paceBox.checked || k < 0) return BASE_MS;
    var chars = Array.from(o.text(k) || '').length;
    return Math.min(MAX_MS, Math.max(BASE_MS, chars / CHARS_PER_S * 1000));
  }
  function go(k) {
    i = Math.max(-1, Math.min(n - 1, k));
    o.show(i);
    progress.value = Math.max(0, i);
    count.textContent = (i + 1) + ' / ' + n;
    if (i >= 0) {
      var small = document.createElement('small');
      small.textContent = '本步 ' + (Math.round(stepMs(i) / Number(speedSel.value) / 100) / 10) + ' 秒';
      count.appendChild(small);
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!playing) return;
    if (i >= n - 1) { setPlaying(false); return; }
    timer = setTimeout(function () { go(i + 1); schedule(); }, stepMs(i) / Number(speedSel.value));
  }
  function setPlaying(p) { playing = p; playBtn.innerHTML = p ? PAUSE : PLAY; playBtn.title = p ? '暂停（空格）' : '播放（空格）'; schedule(); }
  document.getElementById('first').onclick = function () { go(-1); if (o.onFirst) o.onFirst(); setPlaying(false); };
  document.getElementById('prev').onclick = function () { go(i - 1); schedule(); };
  document.getElementById('next').onclick = function () { go(i + 1); schedule(); };
  playBtn.onclick = function () { if (!playing && i >= n - 1) go(-1); setPlaying(!playing); };
  speedSel.onchange = function () { go(i); schedule(); };
  paceBox.onchange = function () { go(i); schedule(); };
  progress.oninput = function () { go(Number(progress.value)); schedule(); };
  document.addEventListener('keydown', function (e) {
    if (e.target === speedSel) return;
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 'ArrowLeft') document.getElementById('prev').click();
    else if (e.key === 'ArrowRight') document.getElementById('next').click();
  });
  go(-1);
  var jump = Number((location.hash || '').slice(1));
  if (n && jump >= 1) { go(Math.min(jump, n) - 1); setPlaying(false); }
  else if (n) { go(0); setPlaying(true); }
  else { caption.textContent = o.empty; setPlaying(false); }
}
`

/** 放进 <script type="application/json">：把 < 换掉，记录里写的 </script> 也关不掉这个标签。 */
const embed = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** 整页：页面自己的样式、主体、脚本，加上共用的字幕、控制器和播放器。 */
export function replayDocument(o: { title: string; css: string; body: string; data: unknown; js: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${o.title}</title>
<style>${SHELL_CSS}${o.css}</style>
</head>
<body>
<div id="app">
${o.body}
${CONTROLS_HTML}
</div>
<script id="replay-data" type="application/json">${embed(o.data)}</script>
<script>${PLAYER_JS}${o.js}</script>
</body>
</html>
`
}
