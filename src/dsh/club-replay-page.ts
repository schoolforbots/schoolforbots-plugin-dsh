// 斗地主对局回放的网页：牌桌是绿色的台面，自家坐在下面，上家在左、下家在右；每家亮出手里的牌（上帝视角），
// 桌子中间是这一轮每家出的牌；顶上是第几局、底牌、底分、倍数。叫分、不要、表情冒气泡，出牌的那一家亮起来。
// 字幕、控制器、节奏、键盘和 #步数 和上课回放一样（replay-shell.ts）。记录里的文字都用 textContent 放进页面。
import type { ClubReplay } from '../core/club-replay.js'
import { replayDocument } from './replay-shell.js'

const CSS = `
:root { --bg:#163f2e; --felt:#1f6b4a; --felt2:#1a5c40; --ink:#222; --muted:#888;
  --mate:#4a78c2; --self:#e0782f; --bot:#7d8790; --land:#c0392b; }
#tablewrap { flex:1; position:relative; min-height:0; overflow:auto; background:radial-gradient(ellipse at center, var(--felt) 0%, var(--felt2) 70%, var(--bg) 100%); color:#fff; }
#table { min-height:100%; display:grid; grid-template-columns:minmax(220px, 1fr) minmax(260px, 1.5fr) minmax(220px, 1fr); grid-template-rows:auto 1fr auto; gap:10px 16px; padding:14px 20px 18px; }
#top { grid-column:1 / 4; display:flex; align-items:center; justify-content:center; gap:22px; flex-wrap:wrap; }
#top h1 { margin:0; font-size:18px; font-weight:600; }
#top .info { font-size:14px; opacity:.9; }
#top .bottom { display:flex; align-items:center; gap:8px; font-size:13px; }
#top .bottom .card { width:28px; height:40px; font-size:13px; }
.seat { position:relative; display:flex; flex-direction:column; align-items:center; gap:6px; --hl:var(--mate); }
.seat.self { --hl:var(--self); }
.seat.bot { --hl:var(--bot); }
#seat-left { grid-column:1; grid-row:2; align-self:center; }
#seat-right { grid-column:3; grid-row:2; align-self:center; }
#seat-me { grid-column:1 / 4; grid-row:3; }
.ident { display:flex; align-items:center; gap:10px; }
.avatar { width:54px; height:54px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--hl); color:#fff; font-size:22px; font-weight:600; border:3px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.3); transition:transform .3s; flex:none; }
.meta { display:flex; flex-direction:column; line-height:1.3; }
.meta .name { font-weight:600; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meta .no { font-size:12px; opacity:.75; font-variant-numeric:tabular-nums; }
.badges { display:flex; gap:4px; flex-wrap:wrap; }
.badge { font-size:11px; padding:0 6px; border-radius:8px; background:rgba(255,255,255,.18); }
.badge.land { background:var(--land); }
.badge.selfb { background:var(--self); }
.badge.trustee { background:#8e44ad; }
.left { font-size:12px; opacity:.85; }
.speaking .avatar { transform:scale(1.15); box-shadow:0 0 0 3px #fff, 0 0 0 8px var(--hl), 0 0 22px 8px var(--hl); animation:glow 1.3s ease-in-out infinite; }
.speaking .name { background:var(--hl); border-radius:8px; padding:0 7px; }
.target .avatar { outline:3px dashed #ffd27a; outline-offset:5px; }
.cards, .hand { display:flex; justify-content:center; padding-left:12px; }
.hand { flex-wrap:wrap; max-width:100%; }
.card { width:36px; height:50px; margin-left:-10px; border-radius:5px; background:#fff; border:1px solid #9aa; color:#222; font-weight:700; font-size:15px; display:flex; align-items:flex-start; justify-content:flex-start; padding:2px 4px; box-shadow:-1px 1px 2px rgba(0,0,0,.25); line-height:1; }
.card.joker { font-size:12px; writing-mode:vertical-rl; letter-spacing:1px; }
.card.big { color:#c0392b; }
.card.back { background:repeating-linear-gradient(45deg, #2d5aa0 0 4px, #24508f 4px 8px); border-color:#fff; }
.hand.small .card { width:30px; height:42px; margin-left:-8px; font-size:13px; padding:2px 3px; }
.hand.small .card.back { margin-left:-16px; }
#seat-me .card { width:40px; height:56px; margin-left:-13px; font-size:17px; }
#center { grid-column:2; grid-row:2; position:relative; min-height:220px; }
.slot { position:absolute; display:flex; flex-direction:column; align-items:center; gap:4px; }
.slot .pass { font-size:16px; opacity:.85; padding:4px 10px; border:1px dashed rgba(255,255,255,.5); border-radius:8px; }
.slot.fresh .cards .card, .slot.fresh .pass { animation:land .35s ease-out; }
@keyframes land { from { transform:translateY(-12px) scale(.9); opacity:0; } to { transform:none; opacity:1; } }
#slot-left { left:0; top:50%; transform:translateY(-50%); align-items:flex-start; }
#slot-right { right:0; top:50%; transform:translateY(-50%); align-items:flex-end; }
#slot-me { left:50%; bottom:0; transform:translateX(-50%); }
.bubble { position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); width:max-content; max-width:260px; background:#fff; color:#222; border:2px solid var(--hl); border-radius:14px; padding:6px 11px; font-size:14px; box-shadow:0 3px 8px rgba(0,0,0,.3); z-index:5; animation:pop .35s ease-out; }
.bubble .tag { display:block; font-size:11px; color:var(--muted); }
.bubble::after { content:""; position:absolute; top:100%; left:50%; margin-left:-7px; border:7px solid transparent; border-top-color:var(--hl); }
#notice { position:absolute; left:50%; top:62px; transform:translateX(-50%); background:rgba(0,0,0,.72); color:#fff; padding:6px 14px; border-radius:16px; font-size:14px; z-index:9; white-space:pre-wrap; animation:pop .35s ease-out; max-width:min(80%, 560px); }
#result { position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); background:#fffdf7; color:#222; border:2px solid #b9a57e; border-radius:12px; padding:14px 20px; box-shadow:0 8px 24px rgba(0,0,0,.35); z-index:9; min-width:260px; white-space:pre-wrap; }
#result h2 { margin:0 0 8px; font-size:17px; }
#result .row { display:flex; justify-content:space-between; gap:20px; font-variant-numeric:tabular-nums; }
#result .plus { color:#1e8449; font-weight:600; }
#result .minus { color:#c0392b; font-weight:600; }
#note { position:absolute; right:12px; bottom:8px; font-size:12px; opacity:.75; }
`

const JS = `
(function () {
  var data = JSON.parse(document.getElementById('replay-data').textContent);
  var steps = data.steps, me = data.me;
  var caption = document.getElementById('caption');
  var wrap = document.getElementById('tablewrap');
  var LEFT = (me + 2) % 3, RIGHT = (me + 1) % 3;
  var place = {}; place[me] = 'me'; place[LEFT] = 'left'; place[RIGHT] = 'right';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function initial(name) { var s = String(name || '?').replace(/（陪练）$/, '').replace(/^.*家的/, ''); return Array.from(s)[0] || '?'; }
  function no(id) { return id == null ? '' : '#' + String(id).padStart(4, '0'); }
  function card(r) {
    var joker = r === '大王' || r === '小王';
    return el('span', 'card' + (joker ? ' joker' : '') + (r === '大王' ? ' big' : ''), r);
  }
  function cards(list, cls) { var d = el('div', cls || 'cards'); list.forEach(function (r) { d.appendChild(card(r)); }); return d; }
  function backs(n, cls) { var d = el('div', cls || 'cards'); for (var j = 0; j < n; j++) d.appendChild(el('span', 'card back')); return d; }

  document.title = data.title;
  document.getElementById('title').textContent = data.title;
  if (!data.godView) document.getElementById('note').textContent = '没取到学校的完整牌谱：只看得到自己的手牌';

  function seatBox(i) { return document.getElementById('seat-' + place[i]); }

  function drawSeat(i, snap, speaking, target) {
    var s = data.seats[i];
    var box = seatBox(i);
    box.textContent = '';
    box.className = 'seat' + (s.self ? ' self' : '') + (s.bot ? ' bot' : '') + (speaking ? ' speaking' : '') + (target ? ' target' : '');
    var who = el('div', 'ident');
    who.appendChild(el('div', 'avatar', initial(s.name)));
    var meta = el('div', 'meta');
    var nm = el('div', 'name', s.name);
    nm.title = s.name;
    meta.appendChild(nm);
    meta.appendChild(el('div', 'no', no(s.studentId)));
    var badges = el('div', 'badges');
    if (snap && snap.landlord === i) badges.appendChild(el('span', 'badge land', '地主'));
    else if (snap && snap.landlord != null) badges.appendChild(el('span', 'badge', '农民'));
    if (s.self) badges.appendChild(el('span', 'badge selfb', '自家'));
    if (snap && snap.trustee[i]) badges.appendChild(el('span', 'badge trustee', '托管中'));
    meta.appendChild(badges);
    who.appendChild(meta);
    box.appendChild(who);
    if (snap) {
      box.appendChild(el('div', 'left', '剩 ' + snap.counts[i] + ' 张'));
      var h = snap.hands[i];
      box.appendChild(h ? cards(h, 'hand' + (i === me ? '' : ' small')) : backs(snap.counts[i], 'hand small'));
    }
    return box;
  }

  function drawSlot(i, snap, fresh) {
    var slot = document.getElementById('slot-' + place[i]);
    slot.textContent = '';
    slot.className = 'slot' + (fresh ? ' fresh' : '');
    var t = snap && snap.table[i];
    if (!t) return;
    if (t.kind === 'pass') slot.appendChild(el('div', 'pass', '不要'));
    else { slot.appendChild(cards(t.move.cards)); slot.appendChild(el('div', 'left', t.move.name)); }
  }

  function clear() {
    Array.prototype.forEach.call(document.querySelectorAll('.bubble, #notice, #result'), function (b) { b.remove(); });
  }

  function show(k) {
    clear();
    caption.textContent = '';
    var s = k >= 0 ? steps[k] : null;
    var snap = s ? s.snap : null;
    var top = document.getElementById('info');
    top.textContent = snap && snap.base != null ? '底分 ' + snap.base + ' · 倍数 ×' + snap.multiplier : '叫分中';
    var bottom = document.getElementById('bottomcards');
    bottom.textContent = '';
    bottom.appendChild(el('span', null, '底牌'));
    bottom.appendChild(snap && snap.bottom ? cards(snap.bottom) : backs(3));
    for (var i = 0; i < 3; i++) {
      drawSeat(i, snap, s && s.seat === i, s && s.to === i);
      drawSlot(i, snap, s && s.seat === i && (s.kind === 'play' || s.kind === 'pass'));
    }
    if (!s) { caption.appendChild(el('span', 'tag', '按 ▶ 开始播放')); return; }
    var who = s.seat == null ? '学校' : data.seats[s.seat].name;
    if (s.kind === 'over') {
      var r = el('div');
      r.id = 'result';
      r.appendChild(el('h2', null, s.text.split('\\n')[0]));
      if (s.scores) s.scores.forEach(function (x, j) {
        var row = el('div', 'row');
        row.appendChild(el('span', null, data.seats[j].name + (snap.landlord === j ? '（地主）' : '')));
        row.appendChild(el('span', x > 0 ? 'plus' : x < 0 ? 'minus' : null, (x > 0 ? '+' : '') + x));
        r.appendChild(row);
      });
      var more = s.text.split('\\n').slice(1).filter(function (l, j) { return j === 0; });
      if (more.length) r.appendChild(el('div', 'left', more[0]));
      wrap.appendChild(r);
    } else if (s.seat == null) {
      var n = el('div', null, s.text);
      n.id = 'notice';
      wrap.appendChild(n);
    } else if (s.kind !== 'play') {
      var b = el('div', 'bubble');
      var tag = [s.tag, s.to != null ? '对 ' + data.seats[s.to].name : '', s.auto || ''].filter(Boolean).join(' · ');
      if (tag) b.appendChild(el('span', 'tag', tag));
      b.appendChild(el('span', null, s.text));
      seatBox(s.seat).appendChild(b);
    }
    caption.appendChild(el('span', 'who', who));
    if (s.tag) caption.appendChild(el('span', 'tag', '[' + s.tag + ']'));
    caption.appendChild(document.createTextNode(s.text + (s.cards && s.cards.length ? '：' + s.cards.join(' ') : '') + (s.auto ? '（' + s.auto + '）' : '')));
  }

  startPlayer({
    count: steps.length,
    text: function (k) { return steps[k].text; },
    show: show,
    empty: '这一局的记录里没有可以播放的事。',
  });
})();
`

export function clubReplayPage(data: ClubReplay): string {
  return replayDocument({
    title: '斗地主回放',
    css: CSS,
    data,
    js: JS,
    body: `  <div id="tablewrap">
    <div id="table">
      <div id="top"><h1 id="title"></h1><span class="info" id="info"></span><span class="bottom" id="bottomcards"></span></div>
      <div class="seat" id="seat-left"></div>
      <div id="center"><div class="slot" id="slot-left"></div><div class="slot" id="slot-right"></div><div class="slot" id="slot-me"></div></div>
      <div class="seat" id="seat-right"></div>
      <div class="seat" id="seat-me"></div>
    </div>
    <div id="note"></div>
  </div>`,
  })
}
