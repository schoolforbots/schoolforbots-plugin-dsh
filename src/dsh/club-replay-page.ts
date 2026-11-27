// 斗地主对局回放的网页：牌桌是绿色的台面，自家坐在下面，上家在左、下家在右；每家亮出手里的牌（上帝视角），
// 桌子中间是这一轮每家出的牌；顶上是第几局、底牌、底分、倍数。叫分、不要、表情冒气泡，出牌的那一家亮起来。
// 牌上的花色是插件自己配的（card-suits.ts）。字幕、控制器、节奏、键盘和 #步数 和上课回放一样（replay-shell.ts）。记录里的文字都用 textContent 放进页面。
import type { ClubReplay } from '../core/club-replay.js'
import { characterFace, faceOf, pageArt, type Face, type PageArt } from './avatar-look.js'
import { cardSuits } from './card-suits.js'
import { replayDocument } from './replay-shell.js'

const CSS = `
:root { --bg:#163f2e; --felt:#1f6b4a; --felt2:#1a5c40; --ink:#222; --muted:#888;
  --mate:#4a78c2; --self:#e0782f; --bot:#7d8790; --land:#c0392b;
  /* 大小跟着窗口走：牌宽（另外两家、自家、桌上刚出的）、头像、名字 */
  --cw:clamp(38px, 3.3vw, 62px); --cwm:clamp(46px, 4.1vw, 76px); --cwp:clamp(50px, 4.6vw, 86px);
  --av:clamp(60px, 5vw, 92px); --fs:clamp(16px, 1.35vw, 24px); }
#tablewrap { flex:1; position:relative; min-height:0; overflow:auto; background:radial-gradient(ellipse at center, var(--felt) 0%, var(--felt2) 70%, var(--bg) 100%); color:#fff; font-size:var(--fs); }
#table { min-height:100%; display:grid; grid-template-columns:minmax(240px, 1.15fr) minmax(280px, 1.4fr) minmax(240px, 1.15fr); grid-template-rows:auto 1fr auto; gap:12px 20px; padding:14px 24px 18px; }
#top { grid-column:1 / 4; display:flex; align-items:center; justify-content:center; gap:28px; flex-wrap:wrap; }
#top h1 { margin:0; font-size:1.25em; font-weight:600; }
#top .info { font-size:1em; opacity:.95; }
#top .bottom { display:flex; align-items:center; gap:10px; font-size:.9em; }
#top .bottom .card { --w:var(--cw); }
/* 底牌没揭开时和揭开后一样排（揭开时不跳） */
#top .bottom .card.back { margin-left:calc(var(--w) * -.3); }
.seat { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; --hl:var(--mate); }
.seat.self { --hl:var(--self); }
.seat.bot { --hl:var(--bot); }
#seat-left { grid-column:1; grid-row:2; align-self:center; }
#seat-right { grid-column:3; grid-row:2; align-self:center; }
#seat-me { grid-column:1 / 4; grid-row:3; }
.ident { display:flex; align-items:center; gap:12px; }
.avatar { width:var(--av); height:var(--av); border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--hl); color:#fff; font-size:calc(var(--av) * .42); font-weight:600; border:3px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.3); transition:transform .3s; flex:none; }
.meta { display:flex; flex-direction:column; line-height:1.3; }
.meta .name { font-weight:600; font-size:1.05em; max-width:16em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meta .no { font-size:.75em; opacity:.8; font-variant-numeric:tabular-nums; }
.badges { display:flex; gap:5px; flex-wrap:wrap; margin-top:2px; }
.badge { font-size:.7em; padding:1px 8px; border-radius:9px; background:rgba(255,255,255,.18); }
.badge.land { background:var(--land); }
.badge.selfb { background:var(--self); }
.badge.trustee { background:#8e44ad; }
.left { font-size:.8em; opacity:.9; }
.speaking .avatar { transform:scale(1.12); box-shadow:0 0 0 3px #fff, 0 0 0 8px var(--hl), 0 0 24px 9px var(--hl); animation:glow 1.3s ease-in-out infinite; }
.speaking .name { background:var(--hl); border-radius:8px; padding:0 8px; }
.target .avatar { outline:3px dashed #ffd27a; outline-offset:6px; }
.cards, .hand { display:flex; justify-content:center; padding-left:calc(var(--w, var(--cw)) * .3); }
.hand { flex-wrap:wrap; max-width:100%; row-gap:6px; }
.card { --w:var(--cw); width:var(--w); height:calc(var(--w) * 1.4); margin-left:calc(var(--w) * -.3); border-radius:calc(var(--w) * .12); background:#fff; border:1px solid #9aa; color:#222; font-weight:700; font-size:calc(var(--w) * .42); display:flex; align-items:flex-start; justify-content:flex-start; padding:3px 4px; box-shadow:-1px 1px 3px rgba(0,0,0,.28); line-height:1; letter-spacing:-.04em; flex:none; }
.card { flex-direction:column; }
.card .suit { font-size:.78em; margin-top:.12em; }
.card.red { color:#c0392b; }
.card.joker { font-size:calc(var(--w) * .32); writing-mode:vertical-lr; letter-spacing:1px; }
.card.back { background:repeating-linear-gradient(45deg, #2d5aa0 0 4px, #24508f 4px 8px); border-color:#fff; margin-left:calc(var(--w) * -.55); }
/* 一排里的第一张牌背和明牌一样只往左压 .3 张（这一排左边留的就是这么多），不压到左边的字 */
.cards > .card.back:first-child, .hand > .card.back:first-child { margin-left:calc(var(--w) * -.3); }
#seat-me .card { --w:var(--cwm); }
#center { grid-column:2; grid-row:2; position:relative; min-height:calc(var(--cwp) * 3.6); }
.slot { position:absolute; display:flex; flex-direction:column; align-items:center; gap:6px; }
.slot .card { --w:var(--cwp); }
.slot .left { font-size:.85em; }
.slot .pass { font-size:1.15em; opacity:.9; padding:6px 16px; border:2px dashed rgba(255,255,255,.55); border-radius:10px; }
.slot.fresh .cards .card, .slot.fresh .pass { animation:land .35s ease-out; }
@keyframes land { from { transform:translateY(-12px) scale(.9); opacity:0; } to { transform:none; opacity:1; } }
#slot-left { left:0; top:50%; transform:translateY(-50%); align-items:flex-start; }
#slot-right { right:0; top:50%; transform:translateY(-50%); align-items:flex-end; }
#slot-me { left:50%; bottom:0; transform:translateX(-50%); }
.bubble { position:absolute; bottom:calc(100% + 8px); left:50%; transform:translateX(-50%); width:max-content; max-width:min(340px, 40vw); background:#fff; color:#222; border:2px solid var(--hl); border-radius:14px; padding:7px 13px; font-size:.95em; box-shadow:0 3px 8px rgba(0,0,0,.3); z-index:5; animation:pop .35s ease-out; }
.bubble .tag { display:block; font-size:.7em; color:var(--muted); }
.bubble::after { content:""; position:absolute; top:100%; left:50%; margin-left:-8px; border:8px solid transparent; border-top-color:var(--hl); }
#notice { position:absolute; left:50%; top:calc(var(--fs) * 4); transform:translateX(-50%); background:rgba(0,0,0,.72); color:#fff; padding:8px 18px; border-radius:18px; font-size:1em; z-index:9; white-space:pre-wrap; animation:pop .35s ease-out; max-width:min(80%, 640px); }
#result { position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); background:#fffdf7; color:#222; border:2px solid #b9a57e; border-radius:14px; padding:18px 26px; box-shadow:0 8px 24px rgba(0,0,0,.35); z-index:9; min-width:min(380px, 80vw); white-space:pre-wrap; font-size:1em; }
#result h2 { margin:0 0 10px; font-size:1.3em; }
#result .row { display:flex; justify-content:space-between; gap:24px; font-variant-numeric:tabular-nums; line-height:1.7; }
#result .plus { color:#1e8449; font-weight:700; }
#result .minus { color:#c0392b; font-weight:700; }
#result .left { color:#666; }
#note { position:absolute; right:12px; bottom:8px; font-size:.75em; opacity:.8; }
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
  // 花色是插件配的（card-suits.ts），每一步一份，和这一步看得见的牌一一对应
  var suits = data.suits || [];
  function card(r, suit) {
    var joker = r === '大王' || r === '小王';
    var red = r === '大王' || suit === '♥' || suit === '♦';
    var c = el('span', 'card' + (joker ? ' joker' : '') + (red ? ' red' : ''), r);
    if (suit && !joker) c.appendChild(el('span', 'suit', suit));
    return c;
  }
  function cards(list, cls, marks) { var d = el('div', cls || 'cards'); list.forEach(function (r, j) { d.appendChild(card(r, marks && marks[j])); }); return d; }
  function backs(n, cls) { var d = el('div', cls || 'cards'); for (var j = 0; j < n; j++) d.appendChild(el('span', 'card back')); return d; }

  document.title = data.title;
  document.getElementById('title').textContent = data.title;
  if (!data.godView) document.getElementById('note').textContent = '没取到学校的完整牌谱：只看得到自己的手牌';

  function seatBox(i) { return document.getElementById('seat-' + place[i]); }

  function drawSeat(i, snap, speaking, target, marks) {
    var s = data.seats[i];
    var box = seatBox(i);
    box.textContent = '';
    box.className = 'seat' + (s.self ? ' self' : '') + (s.bot ? ' bot' : '') + (speaking ? ' speaking' : '') + (target ? ' target' : '');
    var who = el('div', 'ident');
    who.appendChild(face(String(i), initial(s.name)));
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
      box.appendChild(h ? cards(h, 'hand', marks && marks.hands[i]) : backs(snap.counts[i], 'hand'));
    }
    return box;
  }

  function drawSlot(i, snap, fresh, marks) {
    var slot = document.getElementById('slot-' + place[i]);
    slot.textContent = '';
    slot.className = 'slot' + (fresh ? ' fresh' : '');
    var t = snap && snap.table[i];
    if (!t) return;
    if (t.kind === 'pass') slot.appendChild(el('div', 'pass', '不要'));
    else { slot.appendChild(cards(t.move.cards, null, marks && marks.table[i])); slot.appendChild(el('div', 'left', t.move.name)); }
  }

  function clear() {
    Array.prototype.forEach.call(document.querySelectorAll('.bubble, #notice, #result'), function (b) { b.remove(); });
  }

  function show(k) {
    clear();
    caption.textContent = '';
    var s = k >= 0 ? steps[k] : null;
    var snap = s ? s.snap : null;
    var marks = s ? suits[k] : null;
    var top = document.getElementById('info');
    top.textContent = snap && snap.base != null ? '底分 ' + snap.base + ' · 倍数 ×' + snap.multiplier : '叫分中';
    var bottom = document.getElementById('bottomcards');
    bottom.textContent = '';
    bottom.appendChild(el('span', null, '底牌'));
    bottom.appendChild(snap && snap.bottom ? cards(snap.bottom, null, marks && marks.bottom) : backs(3));
    for (var i = 0; i < 3; i++) {
      drawSeat(i, snap, s && s.seat === i, s && s.to === i, marks);
      drawSlot(i, snap, s && s.seat === i && (s.kind === 'play' || s.kind === 'pass'), marks);
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

/** 这一局的形象：有学生带形象才画（旧记录返回 null，照旧用字）。陪练用固定的角色，没带形象的学生用匿名同学。键是座位号。 */
export function clubArt(data: ClubReplay): PageArt | null {
  if (!data.seats.some((s) => s.look)) return null
  const faces: Record<string, Face> = {}
  data.seats.forEach((s, i) => (faces[String(i)] = s.bot ? characterFace('sparring') : s.look ? faceOf(s.look) : characterFace('anonymous')))
  return pageArt(faces)
}

export function clubReplayPage(data: ClubReplay): string {
  const art = clubArt(data)
  return replayDocument({
    title: '斗地主回放',
    css: CSS,
    data: { ...data, suits: cardSuits(data), ...(art ? { art } : {}) },
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
