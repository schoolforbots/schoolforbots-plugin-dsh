// 上课回放的网页：一个自带样式和脚本的 HTML，数据（buildClassReplay 的结果）直接放在页面里，不再请求别的地址，也不连外网。
// - 教室：顶上是黑板和老师（钉住，座位往下滚时也看得到），下面是座位；座位按窗口宽度排，窗口变了就重排，字和人不缩小。
//   自家学生换一种颜色，不在线的同学变淡，名字下面是学号。人多时座位区滚动，说话的人、被说到的人自动滚进来。
// - 一步一个动画：说话的人旁边冒气泡（悄悄话是虚线气泡，标明说给谁，对方的座位亮一下），底部字幕是完整的话；
//   自我介绍里的名字和学号上色。课后小结是一张卡片。
// - 底部控制器：从头、上一步、播放/暂停、下一步、速度，进度条可以拖。一步默认 3 秒；"长的话多停一会儿"开着时，
//   字多的按大约每秒 8 个字多停，最多 30 秒（都是 1× 的时间）。键盘：空格播放/暂停，← → 上一步、下一步。地址后面加 #步数 直接停在那一步。
// - 记录里的文字都是用 textContent 放进页面的，同学写的话不会变成网页代码。
import type { ClassReplay } from '../core/class-replay.js'

const CSS = `
:root { --bg:#f3efe6; --wall:#e9e2d2; --board:#2f4a3a; --chalk:#f4f1e8; --desk:#c99a63; --deskdark:#a87c48;
  --mate:#4a78c2; --self:#e0782f; --teacher:#2e8b57; --ink:#222; --muted:#888; }
* { box-sizing:border-box; }
html,body { margin:0; height:100%; background:var(--bg); color:var(--ink); font:15px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
#app { display:flex; flex-direction:column; height:100%; }
#roomwrap { flex:1; position:relative; min-height:0; }
#room { position:absolute; inset:0; overflow:auto; }
#front { position:sticky; top:0; z-index:8; background:var(--wall); padding:12px 20px 10px; box-shadow:0 2px 6px rgba(0,0,0,.08); display:flex; flex-direction:column; align-items:center; }
#board { width:min(100%, 680px); background:var(--board); color:var(--chalk); border:8px solid #7a5a36; border-radius:6px; padding:8px 18px; text-align:center; box-shadow:0 3px 8px rgba(0,0,0,.25); }
#board h1 { margin:0; font-size:20px; font-weight:600; letter-spacing:1px; }
#board div { opacity:.85; font-size:13px; }
.teacher { position:relative; display:flex; flex-direction:column; align-items:center; margin-top:10px; }
.podium { width:130px; height:16px; background:var(--deskdark); border-radius:4px 4px 0 0; margin-top:-6px; }
.avatar { width:54px; height:54px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:22px; font-weight:600; border:3px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.2); transition:opacity .4s, transform .3s; }
.teacher .avatar { background:var(--teacher); width:56px; height:56px; }
.name { margin-top:4px; font-size:13px; max-width:100%; text-align:center; line-height:1.3; word-break:break-all; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.teacher .name { white-space:nowrap; }
.no { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
#seats { display:grid; grid-template-columns:repeat(auto-fill, minmax(118px, 1fr)); gap:62px 14px; padding:76px 24px 40px; max-width:1500px; margin:0 auto; }
.seat { position:relative; display:flex; flex-direction:column; align-items:center; transition:opacity .4s; min-width:0; }
.seat .avatar { background:var(--mate); }
.seat.self .avatar { background:var(--self); }
.seat.self .name { color:var(--self); font-weight:600; }
.seat.offline { opacity:.32; }
.badge { position:absolute; top:-6px; left:calc(50% + 14px); background:var(--self); color:#fff; font-size:11px; padding:0 6px; border-radius:8px; border:2px solid #fff; }
.desk { width:min(100%, 104px); height:14px; background:var(--desk); border-radius:3px; margin-top:6px; box-shadow:0 3px 0 var(--deskdark); }
.speaking .avatar { transform:scale(1.12); }
.target .avatar { box-shadow:0 0 0 4px rgba(224,120,47,.35), 0 0 14px rgba(224,120,47,.6); }
.bubble { position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); width:max-content; max-width:min(300px, 80vw); background:#fff; border:2px solid var(--mate); border-radius:14px; padding:7px 11px; font-size:14px; box-shadow:0 3px 8px rgba(0,0,0,.15); z-index:5; animation:pop .35s ease-out; }
.bubble::after { content:""; position:absolute; top:100%; left:var(--tail, 50%); margin-left:-7px; border:7px solid transparent; border-top-color:inherit; }
.teacher .bubble { border-color:var(--teacher); max-width:min(520px, calc(50vw - 60px)); bottom:auto; top:0; left:calc(50% + 40px); transform:none; animation:popside .35s ease-out; }
.teacher .bubble::after { top:16px; left:-14px; margin-left:0; border-top-color:transparent; border-right-color:var(--teacher); }
.seat.self .bubble { border-color:var(--self); }
.bubble.whisper { border-style:dashed; background:#fffaf2; }
.bubble .tag { display:block; font-size:11px; color:var(--muted); margin-bottom:2px; }
.bubble .text { display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; white-space:pre-wrap; }
.bubble.blocked .text { text-decoration:line-through; color:#a33; }
.mark-name { color:var(--mate); font-weight:600; }
.mark-self { color:var(--self); font-weight:600; }
.mark-no { color:#b4532a; font-weight:600; font-variant-numeric:tabular-nums; }
#notice { position:absolute; left:50%; transform:translateX(-50%); background:rgba(60,60,60,.9); color:#fff; padding:6px 14px; border-radius:16px; font-size:13px; max-width:min(80%, 560px); white-space:pre-wrap; z-index:9; animation:pop .35s ease-out; }
#notice .text { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
#card { position:absolute; left:50%; transform:translateX(-50%); width:min(92%, 620px); bottom:12px; overflow:auto; background:#fffdf7; border:2px solid #b9a57e; border-radius:12px; padding:14px 18px; box-shadow:0 8px 24px rgba(0,0,0,.25); z-index:9; white-space:pre-wrap; animation:pop .35s ease-out; }
#card h2 { margin:0 0 8px; font-size:16px; }
@keyframes popside { from { opacity:0; transform:translateX(-8px) scale(.94); } to { opacity:1; transform:none; } }
@keyframes pop { from { opacity:0; transform:translateX(-50%) translateY(8px) scale(.92); } to { opacity:1; transform:translateX(-50%) translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { *, *::after { animation:none !important; transition:none !important; } }
#caption { background:#fff; border-top:1px solid #ddd; padding:10px 18px; height:120px; flex:none; overflow:auto; white-space:pre-wrap; }
#caption .who { font-weight:600; margin-right:6px; }
#caption .tag { color:var(--muted); font-size:12px; margin-right:6px; }
#caption .blocked { color:#a33; font-size:13px; display:block; }
#controls { display:flex; align-items:center; gap:10px; padding:8px 16px; background:#2b2b2b; color:#eee; flex-wrap:wrap; }
#controls button { background:#444; color:#fff; border:0; border-radius:6px; padding:6px 12px; font-size:15px; cursor:pointer; min-width:42px; }
#controls button:hover { background:#555; }
#controls select { background:#444; color:#fff; border:0; border-radius:6px; padding:6px; }
#controls label { font-size:13px; display:flex; align-items:center; gap:4px; cursor:pointer; }
#progress { flex:1; min-width:120px; }
#count { min-width:80px; text-align:right; font-variant-numeric:tabular-nums; font-size:13px; }
`

const JS = `
(function () {
  var data = JSON.parse(document.getElementById('replay-data').textContent);
  var steps = data.steps;
  var seatsEl = document.getElementById('seats');
  var teacherEl = document.getElementById('teacher');
  var frontEl = document.getElementById('front');
  var roomEl = document.getElementById('room');
  var wrapEl = document.getElementById('roomwrap');
  var caption = document.getElementById('caption');
  var progress = document.getElementById('progress');
  var count = document.getElementById('count');
  var playBtn = document.getElementById('play');
  var speedSel = document.getElementById('speed');
  var paceBox = document.getElementById('pace');
  var BASE_MS = 3000, CHARS_PER_S = 8, MAX_MS = 30000;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var i = -1, playing = true, timer = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function initial(name) { var s = String(name || '?').replace(/^.*家的/, ''); return Array.from(s)[0] || '?'; }
  function no(id) { return '#' + String(id).padStart(4, '0'); }
  function nameOf(id, names) { return names[id] || no(id); }
  function withNo(id, names) { return nameOf(id, names) + ' ' + no(id); }
  // 一句话：有 parts 的按段上色，没有的就是纯文字
  function fill(node, s) {
    if (s.parts && s.parts.length) s.parts.forEach(function (p) { node.appendChild(p.mark ? el('span', 'mark-' + p.mark, p.text) : document.createTextNode(p.text)); });
    else node.appendChild(document.createTextNode(s.text));
    return node;
  }

  document.getElementById('title').textContent = data.title || '上课回放';
  document.getElementById('sub').textContent = (data.className || '') + (data.teacher ? ' · 老师：' + data.teacher : '');
  document.title = '上课回放 · ' + (data.title || '');
  teacherEl.appendChild(el('div', 'avatar', initial(data.teacher)));
  teacherEl.appendChild(el('div', 'podium'));
  teacherEl.appendChild(el('div', 'name', data.teacher || '老师'));

  var seatEls = {};
  data.seats.forEach(function (s) {
    var d = el('div', 'seat' + (s.self ? ' self' : ''));
    d.appendChild(el('div', 'avatar', initial(s.name)));
    if (s.self) d.appendChild(el('span', 'badge', '自家'));
    d.appendChild(el('div', 'desk'));
    var n = el('div', 'name', s.name);
    n.title = s.name;
    d.appendChild(n);
    d.appendChild(el('div', 'no', no(s.studentId)));
    seatsEl.appendChild(d);
    seatEls[s.studentId] = { box: d, name: n };
  });
  progress.max = Math.max(0, steps.length - 1);

  // 第 k 步时的状态：从头把状态变化放一遍（步数不多，回退也简单）
  function stateAt(k) {
    var online = {}, names = {};
    data.seats.forEach(function (s) { names[s.studentId] = s.name; });
    data.online.forEach(function (id) { online[id] = true; });
    for (var j = 0; j <= k && j < steps.length; j++) {
      steps[j].changes.forEach(function (c) {
        if (c.kind === 'online') online[c.studentId] = c.online;
        if (c.kind === 'rename') names[c.studentId] = c.name;
      });
    }
    return { online: online, names: names };
  }

  // 把座位（连同它头上的气泡）滚进看得见的地方：顶上钉着黑板和老师，要让开
  function follow(box) {
    var bubble = box.querySelector('.bubble');
    var top = Math.min(box.getBoundingClientRect().top, bubble ? bubble.getBoundingClientRect().top : Infinity);
    var bottom = box.getBoundingClientRect().bottom;
    var view = roomEl.getBoundingClientRect();
    var visibleTop = view.top + frontEl.offsetHeight + 8;
    var delta = 0;
    if (top < visibleTop) delta = top - visibleTop;
    else if (bottom > view.bottom - 8) delta = bottom - (view.bottom - 8);
    if (delta) roomEl.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
  }

  // 气泡碰到窗口左右边就往里挪，小尾巴还对着说话的人
  function keepInside(b) {
    var r = b.getBoundingClientRect(), view = roomEl.getBoundingClientRect();
    var shift = 0;
    if (r.right > view.right - 8) shift = (view.right - 8) - r.right;
    if (r.left + shift < view.left + 8) shift = (view.left + 8) - r.left;
    if (!shift) return;
    b.style.marginLeft = shift + 'px';
    b.style.setProperty('--tail', 'calc(50% - ' + shift + 'px)');
  }

  function clear() {
    Array.prototype.forEach.call(document.querySelectorAll('.bubble, #notice, #card'), function (b) { b.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll('.speaking, .target'), function (b) { b.classList.remove('speaking', 'target'); });
  }

  function show(k) {
    i = Math.max(-1, Math.min(steps.length - 1, k));
    var st = stateAt(i);
    Object.keys(seatEls).forEach(function (id) {
      var s = seatEls[id];
      s.box.classList.toggle('offline', !st.online[id]);
      s.name.textContent = nameOf(id, st.names);
      s.name.title = nameOf(id, st.names);
    });
    clear();
    progress.value = Math.max(0, i);
    count.textContent = (i + 1) + ' / ' + steps.length;
    caption.textContent = '';
    caption.scrollTop = 0;
    if (i < 0) { caption.appendChild(el('span', 'tag', '按 ▶ 开始播放')); return; }
    var s = steps[i];
    var who = s.actor.kind === 'teacher' ? (data.teacher || '老师') : s.actor.kind === 'student' ? withNo(s.actor.studentId, st.names) : '学校';
    var toText = s.to.kind === 'student' ? ' → ' + withNo(s.to.studentId, st.names) : s.to.kind === 'teacher' ? ' → 老师' : '';
    var summary = s.actor.kind === 'school' && s.tag === '课后小结';
    var focus = null;
    if (summary) {
      var card = el('div');
      card.id = 'card';
      card.style.top = (frontEl.offsetHeight + 12) + 'px';
      card.appendChild(el('h2', null, '课后小结'));
      card.appendChild(el('div', null, s.text));
      wrapEl.appendChild(card);
    } else if (s.actor.kind === 'school') {
      var n = el('div');
      n.id = 'notice';
      n.style.top = (frontEl.offsetHeight + 12) + 'px';
      n.appendChild(el('span', 'text', s.text));
      wrapEl.appendChild(n);
    } else {
      var host = s.actor.kind === 'teacher' ? teacherEl : (seatEls[s.actor.studentId] || {}).box;
      if (host) {
        var whisper = s.to.kind === 'student' || (s.tag || '').indexOf('悄悄话') >= 0;
        var b = el('div', 'bubble' + (whisper ? ' whisper' : '') + (s.blocked ? ' blocked' : ''));
        var tag = [s.tag, whisper && s.to.kind === 'student' ? '对 ' + nameOf(s.to.studentId, st.names) + ' 说' : '', s.blocked ? '被拦下' : ''].filter(Boolean).join(' · ');
        if (tag) b.appendChild(el('span', 'tag', tag));
        b.appendChild(fill(el('span', 'text'), s));
        host.appendChild(b);
        if (s.actor.kind === 'student') keepInside(b);
        host.classList.add('speaking');
        if (s.actor.kind === 'student') focus = host;
      }
      if (s.to.kind === 'student' && seatEls[s.to.studentId]) seatEls[s.to.studentId].box.classList.add('target');
    }
    if (s.about != null && seatEls[s.about]) {
      seatEls[s.about].box.classList.add('target');
      // 介绍新同学、点名：把被说到的同学滚进来（老师钉在顶上，本来就看得到）
      if (!focus) focus = seatEls[s.about].box;
    }
    if (focus) follow(focus);
    caption.appendChild(el('span', 'who', who + toText));
    if (s.tag) caption.appendChild(el('span', 'tag', '[' + s.tag + ']'));
    if (summary) caption.appendChild(document.createTextNode('（全文见上面的卡片）'));
    else fill(caption, s);
    if (s.blocked) caption.appendChild(el('span', 'blocked', '学校没让这句话发出去：' + s.blocked));
  }

  // 这一步停多久（1× 的毫秒数）：至少 3 秒；"长的话多停一会儿"开着时按字数多停
  function stepMs(s) {
    if (!paceBox.checked || !s) return BASE_MS;
    var chars = Array.from(s.text || '').length;
    return Math.min(MAX_MS, Math.max(BASE_MS, chars / CHARS_PER_S * 1000));
  }

  function schedule() {
    clearTimeout(timer);
    if (!playing) return;
    if (i >= steps.length - 1) { setPlaying(false); return; }
    timer = setTimeout(function () { show(i + 1); schedule(); }, stepMs(steps[i]) / Number(speedSel.value));
  }
  function setPlaying(p) { playing = p; playBtn.textContent = p ? '⏸' : '▶'; playBtn.title = p ? '暂停（空格）' : '播放（空格）'; schedule(); }

  document.getElementById('first').onclick = function () { show(-1); roomEl.scrollTop = 0; setPlaying(false); };
  document.getElementById('prev').onclick = function () { show(i - 1); schedule(); };
  document.getElementById('next').onclick = function () { show(i + 1); schedule(); };
  playBtn.onclick = function () { if (!playing && i >= steps.length - 1) show(-1); setPlaying(!playing); };
  speedSel.onchange = schedule;
  paceBox.onchange = schedule;
  progress.oninput = function () { show(Number(progress.value)); schedule(); };
  document.addEventListener('keydown', function (e) {
    if (e.target === speedSel) return;
    if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
    else if (e.key === 'ArrowLeft') document.getElementById('prev').click();
    else if (e.key === 'ArrowRight') document.getElementById('next').click();
  });

  show(-1);
  // 地址后面带 #步数（从 1 数）：直接停在那一步
  var jump = Number((location.hash || '').slice(1));
  if (steps.length && jump >= 1) { show(Math.min(jump, steps.length) - 1); setPlaying(false); }
  else if (steps.length) { show(0); setPlaying(true); }
  else { caption.textContent = '这节课的记录里没有可以播放的事。'; setPlaying(false); }
})();
`

/** 放进 <script type="application/json">：把 < 换掉，同学写的 </script> 也关不掉这个标签。 */
const embed = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function replayPage(data: ClassReplay): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>上课回放</title>
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <div id="roomwrap">
    <div id="room">
      <div id="front">
        <div id="board"><h1 id="title"></h1><div id="sub"></div></div>
        <div class="teacher" id="teacher"></div>
      </div>
      <div id="seats"></div>
    </div>
  </div>
  <div id="caption"></div>
  <div id="controls">
    <button id="first" title="从头">⏮</button>
    <button id="prev" title="上一步（←）">◀◀</button>
    <button id="play" title="播放/暂停（空格）">⏸</button>
    <button id="next" title="下一步（→）">▶▶</button>
    <select id="speed" title="速度">
      <option value="0.5">0.5×</option>
      <option value="0.75">0.75×</option>
      <option value="1" selected>1×（一步 3 秒）</option>
      <option value="1.5">1.5×</option>
      <option value="2">2×</option>
      <option value="4">4×</option>
    </select>
    <label title="字多的一步按大约每秒 8 个字多停一会儿，最多 30 秒（1× 的时间）"><input id="pace" type="checkbox" checked>长的话多停一会儿</label>
    <input id="progress" type="range" min="0" value="0">
    <span id="count"></span>
  </div>
</div>
<script id="replay-data" type="application/json">${embed(data)}</script>
<script>${JS}</script>
</body>
</html>
`
}
