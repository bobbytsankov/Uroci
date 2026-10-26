/* Механизъм за урок с видео.
   Урокът описва себе си в window.LESSON (виж файла на урока); тук се изгражда интерфейсът.
   Без видеофайл се пуска демо часовник върху статичния кадър <template id="poster">. */
(() => {
  'use strict';
  const L = window.LESSON;
  const app = document.getElementById('app');
  // Изходният вид на страницата, за запис от „Редакция“ (вземаме го, преди интерфейсът да смени заглавието)
  const SRC = {
    title: document.querySelector('title')?.textContent || L.title,
    css: [...document.querySelectorAll('link[rel="stylesheet"]')].map((n) => n.getAttribute('href')).filter((h) => h && !/^(https?:|\/|data:)/.test(h)),
    js: document.currentScript?.getAttribute('src') || 'engine/lesson.js'
  };
  const VB = { w: 1600, h: 900 };            // координати на бележките върху видеото
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  };
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const tc = (t) => {                          // 0:00:41:00 като в After Effects
    const f = Math.floor((t % 1) * (L.fps || 25)), s = Math.floor(t);
    return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };
  const fmt = (t) => {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const tpl = (id) => {
    const t = document.getElementById(id);
    return t ? t.content.cloneNode(true) : el('p', {}, `Липсва шаблон #${id}`);
  };
  const icon = {
    play: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M6 3.5l12 7.5-12 7.5z" fill="currentColor"/></svg>',
    pause: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="5" y="4" width="4.5" height="14" fill="currentColor"/><rect x="12.5" y="4" width="4.5" height="14" fill="currentColor"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 5L4 11l7 6M18 5l-7 6 7 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    fwd: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 5l7 6-7 6M4 5l7 6-7 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    panel: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="2.5" y="3.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M13.5 4v14" stroke="currentColor" stroke-width="1.8"/></svg>',
    done: '<svg class="dot" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--ok)"/><path d="M5.5 10.5l3 3 6-7" stroke="var(--on-ok)" stroke-width="2" fill="none"/></svg>',
    now: '<svg class="dot" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3l12 7-12 7z" fill="currentColor"/></svg>',
    todo: '<svg class="dot" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    page: '<svg class="dot" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3.5 3.5v11.5h-10.5z" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>'
  };

  /* ---------- Данни ---------- */
  const chapters = L.chapters.map((c, i) => ({ ...c, i, video: c.start != null }));
  const videoChapters = chapters.filter((c) => c.video);
  videoChapters.forEach((c, k) => { c.end = c.end ?? videoChapters[k + 1]?.start ?? L.video.duration; });
  const steps = (L.steps || []).slice().sort((a, b) => a.t - b.t);
  const cues = (L.cues || []).map((c, i) => ({ ...c, i, until: c.until ?? c.t + 6 }));
  const D = L.video.duration;

  const state = {
    t: 0, playing: false, rate: 1, demo: !L.video.src, page: null,
    userClosed: false, panelId: null, sig: '', lastT: 0, visited: new Set(), editing: false
  };

  // Текст, който в режим „Редакция“ се поправя на място; write(node) връща поправката в шаблона или в L
  const writers = new WeakMap();
  function editable(node, write, plain) {
    writers.set(node, write);
    if (state.editing) {
      try { node.contentEditable = plain ? 'plaintext-only' : 'true'; } catch { node.contentEditable = 'true'; }
      node.classList.add('editable');
      if (plain) node.dataset.plain = '';
    } else {
      node.removeAttribute('contenteditable');
      node.classList.remove('editable');
    }
    return node;
  }
  const tplWriter = (id) => (n) => { const t = document.getElementById(id); if (t) t.innerHTML = n.innerHTML; };

  /* ---------- Каркас ---------- */
  document.title = `${L.title} · ${L.course}`;
  const tabs = el('nav', { class: 'tabs', 'aria-label': 'Глави' });
  const top = el('header', { class: 'top' },
    el('div', { class: 'brand', html: (L.brandIcon || '') + `<span>${L.brand || 'Урок'}</span>` }),
    tabs,
    el('div', { class: 'meta', html: `<b>${L.title}</b><span>·</span><span>${L.course}</span><span>·</span><span>${L.task}</span>` })
  );

  const stepList = el('ol');
  const stepsRegion = el('nav', { class: 'region steps', 'aria-label': 'Стъпки' },
    el('div', { class: 'rhead', html: `<b>${L.labels?.steps || 'Стъпки'}</b>` }),
    stepList,
    el('div', { class: 'about', html: `<b>${L.title}</b>${L.summary || ''}` })
  );

  const frame = el('div', { class: 'frame' });
  const overlay = svg('svg', { class: 'overlay', viewBox: `0 0 ${VB.w} ${VB.h}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const layer = el('div', { class: 'cues', 'aria-live': 'polite' });
  const page = el('div', { class: 'page', hidden: true });
  const stageSub = el('span');
  const stageTime = el('span', { class: 'push' });
  const stage = el('main', { class: 'region stage' },
    el('div', { class: 'rhead', html: `<b>${L.labels?.video || 'Видео'}</b>` }, stageSub, stageTime),
    el('div', { class: 'stage-body' }, frame, page)
  );

  let video = null;
  if (!state.demo) {
    video = el('video', { src: L.video.src, preload: 'auto', playsinline: true });
    video.addEventListener('error', () => startDemo('видеото не се зареди'));
    video.addEventListener('ended', () => setPlaying(false));
    frame.append(video);
  }
  function startDemo(reason) {
    state.demo = true;
    if (video) { video.remove(); video = null; }
    const poster = el('div', { class: 'poster' });
    poster.append(tpl('poster'));
    frame.prepend(poster);
    stageSub.after(el('span', { class: 'demo-flag', title: reason || '' }, 'ДЕМО', el('span', { class: 'demo-more' }, ' · без видео')));
  }
  if (state.demo) startDemo('няма зададен видеофайл');
  frame.append(overlay, layer);

  const playBtn = el('button', { class: 'ctl-btn', 'aria-label': 'Пусни', title: 'Пусни / пауза (интервал)', html: icon.play, onclick: () => setPlaying(!state.playing) });
  const timeEl = el('span', { class: 'time' });
  const fill = el('div', { class: 'fill' });
  const scrub = el('div', { class: 'scrub', role: 'slider', tabindex: 0, 'aria-label': 'Позиция във видеото', 'aria-valuemin': 0, 'aria-valuemax': Math.round(D) },
    el('div', { class: 'track' }), fill, ...steps.map((s) => el('i', { class: 'tick', style: `left:${(s.t / D) * 100}%` })));
  const rateBtn = el('button', { class: 'rate', title: 'Скорост', onclick: cycleRate }, '1×');
  const panelBtn = el('button', { class: 'ctl-btn', 'aria-label': 'Панел с обяснение', title: 'Панел с обяснение (P)', 'aria-pressed': 'false', html: icon.panel, onclick: togglePin });
  const controls = el('div', { class: 'controls' },
    el('button', { class: 'ctl-btn', 'aria-label': 'Предишна стъпка', title: 'Предишна стъпка (↑)', html: icon.back, onclick: () => jumpStep(-1) }),
    playBtn,
    el('button', { class: 'ctl-btn', 'aria-label': 'Следваща стъпка', title: 'Следваща стъпка (↓)', html: icon.fwd, onclick: () => jumpStep(1) }),
    timeEl, scrub, rateBtn, panelBtn);
  stage.append(controls);

  const pTitle = el('b');
  const pBody = el('div', { class: 'pbody' });
  const panel = el('aside', { class: 'region panel', 'aria-label': 'Обяснение' },
    el('div', { class: 'rhead' }, pTitle,
      el('button', { class: 'push ctl-btn', 'aria-label': 'Затвори панела', title: 'Затвори (P)', html: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2"/></svg>', onclick: closePanel })),
    pBody);

  const tlBody = el('div', { class: 'tl-body' });
  const timeline = el('section', { class: 'region timeline', 'aria-label': 'Времева линия' },
    el('div', { class: 'rhead', html: `<b>${L.labels?.timeline || 'Timeline'}</b><span>кликни маркер, за да прескочиш</span><span class="push">${steps.length} стъпки</span>` }),
    tlBody);

  app.append(top, stepsRegion, stage, panel, timeline);
  app.classList.add('panel-closed');

  /* ---------- Глави ---------- */
  const tabEls = chapters.map((c) => {
    const b = el('button', { class: 'tab', onclick: () => goChapter(c) }, c.title);
    tabs.append(b);
    return b;
  });
  const stepEls = chapters.map((c, k) => {
    const b = el('button', { class: 'step', onclick: () => goChapter(c), html: (c.video ? icon.todo : icon.page) + `<span>${c.video ? (videoChapters.indexOf(c) + 1) + ' ' : ''}${c.title}</span>` });
    stepList.append(el('li', {}, b));
    return b;
  });

  function goChapter(c) {
    if (c.video) {
      showPage(null);
      seek(c.start + 0.01);
    } else {
      setPlaying(false);
      showPage(c);
    }
  }
  function showPage(c) {
    state.page = c;
    page.hidden = !c;
    frame.hidden = !!c;
    controls.setAttribute('aria-disabled', c ? 'true' : 'false');
    if (c) { page.replaceChildren(editable(el('div', { class: 'page-inner' }, tpl(c.page)), tplWriter(c.page))); page.scrollTop = 0; }
    instant(() => { if (c) app.classList.add('panel-closed'); render(true); });
  }

  /* ---------- Времева линия ---------- */
  const pct = (t) => `${(t / D) * 100}%`;
  const ruler = el('div', { class: 'tl-row ruler' }, el('div', { class: 'tl-name' }));
  const rulerTrack = el('div', { class: 'tl-track' });
  const tickEvery = D > 300 ? 60 : D > 120 ? 30 : 15;
  for (let t = 0; t <= D + 0.1; t += tickEvery) rulerTrack.append(el('span', { style: `left:${pct(t)}` }, fmt(t)));
  ruler.append(rulerTrack);
  tlBody.append(ruler);

  const trackClick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * D);
  };
  const markEls = [];
  const bandEls = [];
  const rowEls = [];
  const markFor = (s) => {
    const m = el('button', { class: 'mark', style: `left:${pct(s.t)}`, title: `${fmt(s.t)} · ${s.label}`, onclick: (e) => { e.stopPropagation(); seek(s.t); } },
      el('i', { class: 'gem' }), L.timeline === 'layers' ? null : el('span', {}, s.label));
    markEls.push([m, s]);
    return m;
  };
  let tracks = [];
  if (L.timeline === 'layers') {
    videoChapters.forEach((c, k) => {
      const track = el('div', { class: 'tl-track', onclick: trackClick });
      const band = el('div', { class: 'band', style: `left:${pct(c.start)};width:${pct(c.end - c.start)};--c:${c.color || 'var(--band)'}`, title: c.title });
      bandEls.push([band, c]);
      track.append(band);
      steps.filter((s) => s.t >= c.start && s.t < c.end).forEach((s) => track.append(markFor(s)));
      const row = el('div', { class: 'tl-row' }, el('div', { class: 'tl-name', html: `<i style="--c:${c.color || 'var(--band)'}"></i><span>${k + 1} ${c.title}</span>` }), track);
      rowEls.push([row, c]);
      tlBody.append(row);
      tracks.push(track);
    });
  } else {
    const track = el('div', { class: 'tl-track', onclick: trackClick });
    videoChapters.forEach((c) => {
      const band = el('div', { class: 'band', style: `left:${pct(c.start)};width:${pct(c.end - c.start)}`, title: c.title });
      bandEls.push([band, c]);
      track.append(band);
    });
    steps.forEach((s) => track.append(markFor(s)));
    const row = el('div', { class: 'tl-row markers' }, el('div', { class: 'tl-name' }, L.labels?.track || 'Видео'), track);
    tlBody.append(row);
    tracks.push(track);
  }
  /* ---------- Понятия и клавиши за текущата глава ---------- */
  const hasCtx = chapters.some((c) => c.terms?.length || c.keys?.length);
  const ctx = el('div', { class: 'ctx', 'aria-live': 'polite' });
  if (hasCtx) { app.classList.add('has-ctx'); tlBody.append(ctx); }
  let termEls = [];
  function renderCtx(ch, act) {
    const live = act.filter((c) => c.type === 'keys').map((c) => c.keys.join('+'));
    const sig = (ch ? ch.i : -1) + '|' + live.join(',') + (state.editing ? '|edit' : '');
    if (sig === state.ctxSig) return;
    state.ctxSig = sig;
    const terms = ch?.terms || [], keys = ch?.keys || [];
    termEls = [];
    const dl = el('dl', { class: 'terms' }, ...terms.map((t) => {
      const has = t.at != null && !state.editing;   // при редакция понятието не е бутон, за да се пише в него
      // Маркерът в лентата, който съответства на момента на понятието
      const mk = has ? markEls.reduce((b, x) => (!b || Math.abs(x[1].t - t.at) < Math.abs(b[1].t - t.at) ? x : b), null) : null;
      const hint = (on) => { if (mk && Math.abs(mk[1].t - t.at) < 1.5) { mk[0].classList.toggle('hint', on); if (on) restart(mk[0], 'ping'); } };
      const item = el(has ? 'button' : 'div', { class: 'term', title: has ? `Покажи във видеото (${fmt(t.at)})` : null, onclick: has ? () => seek(t.at) : null,
        onmouseenter: has ? () => hint(true) : null, onmouseleave: has ? () => hint(false) : null, onfocus: has ? () => hint(true) : null, onblur: has ? () => hint(false) : null },
        t.fig ? figHTML(t.fig) : null,
        editable(el('dt', {}, t.t), (n) => { t.t = n.textContent; }, true),
        editable(el('dd', {}, t.d), (n) => { t.d = n.textContent; }, true),
        t.at != null ? el('span', { class: 'at' }, el('i', { class: 'gem' }), el('span', {}, `Във видеото ${fmt(t.at)}`)) : null);
      if (has) termEls.push([item, t.at]);
      return item;
    }));
    const kl = el('ul', { class: 'keylist' }, ...keys.map((k) => el('li', { class: live.includes(k.k.join('+')) ? 'now' : '' },
      el('span', { class: 'combo' }, ...k.k.flatMap((x, i) => i ? [el('span', { class: 'plus' }, '+'), el('kbd', {}, x)] : [el('kbd', {}, x)])),
      editable(el('span', { class: 'act' }, k.a), (n) => { k.a = n.textContent; }, true),
      k.d ? editable(el('span', { class: 'kd' }, k.d), (n) => { k.d = n.textContent; }, true) : null)));
    ctx.replaceChildren(
      el('section', { class: 'ctx-terms' }, el('h4', {}, L.labels?.terms || 'Понятия'), terms.length ? dl : el('p', { class: 'empty' }, 'Няма нови понятия в тази глава.')),
      el('section', { class: 'ctx-keys' }, el('h4', {}, L.labels?.keys || 'Клавиши'), keys.length ? kl : el('p', { class: 'empty' }, 'Без клавиши в тази глава.')));
    // Нова глава: редовете влизат един след друг; смяна само на активния клавиш не ги раздвижва
    const chId = ch ? ch.i : -1;
    if (chId !== state.ctxCh) { state.ctxCh = chId; restart(ctx, 'ctx-in'); }
  }
  function restart(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }

  /* ---------- Живи схеми за понятията (term.fig) ---------- */
  const fA = 'var(--accent)', fG = 'var(--gem)', fD = 'var(--text-dim)', fT = 'var(--text)', fB = 'var(--line)';
  const gem = (x, y) => `<path d="M${x} ${y - 6}l6 6-6 6-6-6z" fill="${fG}"/>`;
  const FIGS = {
    keys: () => `<path d="M8 48H112" stroke="${fB}" stroke-width="2"/>${gem(24, 48)}${gem(96, 48)}<circle cx="24" cy="14" r="8" fill="none" stroke="${fA}" stroke-width="2.5"/><circle cx="96" cy="36" r="8" fill="none" stroke="${fA}" stroke-width="2.5"/><path d="M24 24V40M96 44V44" stroke="${fD}" stroke-dasharray="2 3"/>`,
    interp: () => `<path d="M8 48H112" stroke="${fB}" stroke-width="2"/>${gem(18, 48)}${gem(102, 48)}${[38, 60, 82].map((x, i) => `<circle cx="${x}" cy="${14 + (i + 1) * 5}" r="5" fill="${fD}" opacity=".45"/>`).join('')}<circle cx="18" cy="14" r="7" fill="${fA}"><animate attributeName="cx" values="18;102;18" dur="2.4s" repeatCount="indefinite"/><animate attributeName="cy" values="14;34;14" dur="2.4s" repeatCount="indefinite"/></circle>`,
    frames: () => `${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${6 + i * 18.5}" y="12" width="15" height="24" rx="2" fill="none" stroke="${fD}" stroke-width="1.5"/>`).join('')}<rect x="6" y="12" width="15" height="24" rx="2" fill="${fA}" opacity=".85"><animate attributeName="x" values="6;24.5;43;61.5;80;98.5" dur="1.5s" calcMode="discrete" repeatCount="indefinite"/></rect><text x="60" y="52" font-size="10" fill="${fD}" text-anchor="middle">24 кадъра = 1 сек.</text>`,
    curve: () => `<path d="M6 50H114M6 50V4" stroke="${fB}" stroke-width="1.5"/><path id="fc" d="M12 10Q34 10 46 48Q64 18 82 48Q94 34 106 48" fill="none" stroke="${fA}" stroke-width="2.5"/><circle class="mv" r="4" fill="${fT}"><animateMotion dur="2.6s" repeatCount="indefinite"><mpath href="#fc"/></animateMotion></circle>`,
    channel: () => `<rect x="4" y="8" width="44" height="40" rx="3" fill="none" stroke="${fB}"/><rect x="8" y="14" width="3" height="10" fill="var(--channel)"/><path d="M15 19H42" stroke="${fT}" stroke-width="2"/><path d="M15 33H38" stroke="${fD}" stroke-width="2"/><path d="M48 19C60 19 66 10 78 10S96 44 112 44" fill="none" stroke="${fA}" stroke-width="2.5"/>`,
    handles: () => `<path d="M10 44Q60 44 60 26T110 8" fill="none" stroke="${fD}" stroke-width="2"/><path d="M36 26H84" stroke="var(--handle)" stroke-width="2"/><circle cx="36" cy="26" r="4" fill="var(--handle)"/><circle cx="84" cy="26" r="4" fill="var(--handle)"/><rect x="55" y="21" width="10" height="10" fill="${fG}"/>`,
    vector: () => `<path d="M10 8Q34 8 60 48Q86 8 110 8" fill="none" stroke="${fA}" stroke-width="2.5"/><path d="M44 22L60 48L76 22" fill="none" stroke="var(--handle)" stroke-width="2"/><rect x="55" y="43" width="10" height="10" fill="${fG}"/><circle class="mv" r="4.5" fill="${fT}"><animateMotion dur="1.6s" repeatCount="indefinite" path="M10 8Q34 8 60 48Q86 8 110 8"/></circle>`,
    clamped: () => `<path d="M10 8Q40 8 60 46Q80 8 110 8" fill="none" stroke="${fD}" stroke-width="2" stroke-dasharray="4 3"/><path d="M10 8C40 8 44 46 60 46S80 8 110 8" fill="none" stroke="${fA}" stroke-width="2.5"/><path d="M42 46H78" stroke="var(--handle)" stroke-width="2"/><rect x="55" y="41" width="10" height="10" fill="${fG}"/>`,
    timing: () => `<text x="4" y="18" font-size="10" fill="${fD}">бързо</text><text x="4" y="44" font-size="10" fill="${fD}">бавно</text>${[0, 1, 2, 3].map((i) => `<circle cx="${48 + i * 20}" cy="15" r="4" fill="${fA}"/>`).join('')}${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle cx="${42 + i * 10}" cy="41" r="4" fill="${fD}"/>`).join('')}`,
    spacing: () => `<path d="M6 48H114" stroke="${fB}" stroke-width="1.5"/>${[10, 16, 26, 40, 60, 86, 112].map((x) => `<circle cx="${x}" cy="30" r="5" fill="${fA}" opacity=".9"/><path d="M${x} 44V52" stroke="${fD}"/>`).join('')}<text x="60" y="14" font-size="10" fill="${fD}" text-anchor="middle">ускорява →</text>`,
    layers: () => `${[0, 1, 2].map((i) => `<path d="M${16 + i * 22} ${10 + i * 6}l34 -4v34l-34 4z" fill="${i === 2 ? fA : 'none'}" fill-opacity="${i === 2 ? '.25' : '0'}" stroke="${i === 2 ? fA : fD}" stroke-width="2"/>`).join('')}<text x="104" y="50" font-size="10" fill="${fD}" text-anchor="end">далече → близо</text>`,
    parallax: () => `<path d="M4 50H116" stroke="${fB}" stroke-width="1.5"/><rect x="40" y="10" width="16" height="22" fill="${fD}"><animate attributeName="x" values="40;48;40" dur="2.4s" repeatCount="indefinite"/></rect><rect x="60" y="18" width="18" height="30" fill="${fA}"><animate attributeName="x" values="60;84;60" dur="2.4s" repeatCount="indefinite"/></rect><text x="4" y="12" font-size="10" fill="${fD}">далече: малко</text><text x="116" y="12" font-size="10" fill="${fA}" text-anchor="end">близо: много</text>`,
    camera: () => `<rect x="6" y="20" width="22" height="16" rx="3" fill="none" stroke="${fT}" stroke-width="2"/><path d="M28 24l8 -4v16l-8 -4z" fill="${fT}"/><path d="M36 28L112 8M36 28L112 48" stroke="${fA}" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M80 14v28M100 10v36" stroke="${fD}" stroke-width="2"/>`,
    ease: () => `<path d="M8 50H114M8 50V4" stroke="${fB}" stroke-width="1.5"/><path d="M10 48L110 8" stroke="${fD}" stroke-dasharray="3 3"/><path id="fe" d="M10 48C60 48 60 8 110 8" fill="none" stroke="${fA}" stroke-width="2.5"/>${gem(10, 48)}${gem(110, 8)}<circle class="mv" r="4" fill="${fT}"><animateMotion dur="2.2s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#fe"/></animateMotion></circle>`,
    preview: () => `<path d="M10 14L30 26L10 38Z" fill="${fA}"/><path d="M40 50H114" stroke="${fB}" stroke-width="2"/><circle cx="76" cy="12" r="7" fill="${fT}"><animate attributeName="cy" values="12;43;20;43;30;43" keyTimes="0;.3;.5;.7;.85;1" dur="1.8s" repeatCount="indefinite"/></circle>`
  };
  const figHTML = (name) => {
    const f = FIGS[name];
    if (!f) return null;
    let s = f();
    if (reduceMotion) s = s.replace(/<circle class="mv"[\s\S]*?<\/circle>/g, '').replace(/<animate(Motion)?[^>]*(\/>|>[\s\S]*?<\/animate(Motion)?>)/g, '');
    return el('div', { class: 'fig', 'aria-hidden': 'true', html: `<svg viewBox="0 0 120 56" width="120" height="56">${s}</svg>` });
  };

  const playhead = el('div', { class: 'playhead' }, el('span'));
  const phHost = el('div', { class: 'ph-host' });
  tlBody.append(phHost);
  phHost.append(playhead);

  /* ---------- Бележки върху видеото ---------- */
  // Видимата част от кадъра 1600 × 900 и мащабът ѝ. Рамката е заключена на 16:9 (целият кадър),
  // затова изрязване няма; сметката остава обща, ако рамката някога смени съотношението.
  function view() {
    const fw = Math.max(frame.clientWidth, 1), fh = Math.max(frame.clientHeight, 1);
    const s = Math.max(fw / VB.w, fh / VB.h), w = fw / s, h = fh / s;
    return { s, x0: (VB.w - w) / 2, y0: (VB.h - h) / 2, w, h };
  }
  function drawCallout(c) {
    const v = view();
    const k = Math.max(1, (1 / v.s) * 18 / 34);   // надписът никога под ~18px
    const g = svg('g', { class: reduceMotion ? '' : 'cue-in', style: `transform-origin:${c.x}px ${c.y}px` });
    const r = (c.r || 38) * Math.min(k, 1.6);
    const lx = c.lx ?? c.x + 90, ly = c.ly ?? c.y + 90;
    g.append(svg('circle', { cx: c.x, cy: c.y, r, fill: 'none', stroke: 'var(--cue)', 'stroke-width': 6 * Math.min(k, 2) }));
    const ang = Math.atan2(ly - c.y, lx - c.x);
    g.append(svg('path', { d: `M${c.x + Math.cos(ang) * r} ${c.y + Math.sin(ang) * r}L${lx} ${ly}`, stroke: 'var(--cue)', 'stroke-width': 5 * Math.min(k, 2) }));
    const label = svg('text', { x: 0, y: 0, 'font-size': 34 * k, 'font-weight': 600, fill: 'var(--on-cue)', 'font-family': 'var(--font-ui)' });
    label.textContent = c.label;
    const box = svg('rect', { rx: 8, fill: 'var(--cue)' });
    g.append(box, label);
    overlay.append(g);
    const w = label.getComputedTextLength() + 44 * k, h = 60 * k;
    box.setAttribute('width', w);
    box.setAttribute('height', h);
    const bx = lx - (lx < c.x ? w : 0), by = ly - h / 2;
    box.setAttribute('x', Math.min(Math.max(bx, v.x0 + 10), v.x0 + v.w - w - 10));
    box.setAttribute('y', Math.min(Math.max(by, v.y0 + 10), v.y0 + v.h - h - 10));
    label.setAttribute('x', +box.getAttribute('x') + 22 * k);
    label.setAttribute('y', +box.getAttribute('y') + 42 * k);
  }
  function drawKeys(c) {
    const parts = [];
    c.keys.forEach((k, i) => {
      if (i) parts.push(el('span', { class: 'plus' }, '+'));
      parts.push(el('kbd', {}, k));
    });
    if (c.action) parts.push(el('span', { class: 'arrow' }, '→'), el('span', {}, c.action));
    layer.append(el('div', { class: 'keys' + (reduceMotion ? '' : ' cue-in') }, ...parts));
  }
  function drawNote(c) {
    const v = view();
    layer.append(el('div', { class: 'note' + (reduceMotion ? '' : ' cue-in'), style: `left:${Math.max(8, (c.x - v.x0) * v.s)}px;top:${Math.max(8, (c.y - v.y0) * v.s)}px`, html: c.html }));
  }

  /* ---------- Панел ----------
     Панелът не се затваря сам: щом се отвори, той само сменя съдържанието си, за да не мени размера на видеото.
     Затваря се от X или P и остава затворен, докато зрителят не го отвори отново. */
  function instant(fn) {                         // промяна на колоните без анимация (зареждане, страница ↔ видео)
    app.classList.add('no-anim');
    fn();
    requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('no-anim')));
  }
  function openPanel(id, animate) {
    if (!id || state.userClosed) return;
    panelBtn.setAttribute('aria-pressed', 'true');
    if (state.panelId !== id) {
      const t = document.getElementById(id);
      pTitle.textContent = t?.dataset.title || '';
      pBody.replaceChildren(tpl(id));
      editable(pBody, tplWriter(id));
      pBody.scrollTop = 0;
      if (animate && !reduceMotion) { panel.classList.remove('panel-in'); void panel.offsetWidth; panel.classList.add('panel-in'); }
      state.panelId = id;
    }
    app.classList.remove('panel-closed');
  }
  function closePanel() {
    state.userClosed = true;
    panelBtn.setAttribute('aria-pressed', 'false');
    app.classList.add('panel-closed');
  }
  function togglePin() {
    if (state.page) return;
    if (!app.classList.contains('panel-closed')) { closePanel(); return; }
    state.userClosed = false;
    openPanel(activePanelCue()?.panel || currentChapter()?.panel || state.panelId, true);
  }

  /* ---------- Време ---------- */
  function currentChapter() { return videoChapters.find((c) => state.t >= c.start && state.t < c.end) || videoChapters[videoChapters.length - 1]; }
  function activeCues() { return cues.filter((c) => state.t >= c.t && state.t < c.until); }
  function activePanelCue() { return activeCues().find((c) => c.type === 'panel'); }

  function seek(t) {
    t = Math.min(Math.max(t, 0), D);
    state.t = t; state.lastT = t;
    if (video) video.currentTime = t;
    if (state.page) showPage(null);
    // Скок: линията на времето и запълването се плъзгат до новото място (само докато трае скокът)
    restart(app, 'seeking');
    clearTimeout(state.seekTimer);
    state.seekTimer = setTimeout(() => app.classList.remove('seeking'), 300);
    render(true);
  }
  function setPlaying(p) {
    if (state.page && p) return;
    if (p && state.t >= D - 0.05) seek(0);
    state.playing = p;
    playBtn.innerHTML = p ? icon.pause : icon.play;
    playBtn.setAttribute('aria-label', p ? 'Пауза' : 'Пусни');
    if (video) { if (p) video.play().catch(() => {}); else video.pause(); }
  }
  function cycleRate() {
    const rates = [1, 0.5, 0.75, 1.5];
    state.rate = rates[(rates.indexOf(state.rate) + 1) % rates.length];
    rateBtn.textContent = `${state.rate}×`;
    if (video) video.playbackRate = state.rate;
  }
  function jumpStep(dir) {
    const eps = 0.25;
    const s = dir > 0 ? steps.find((x) => x.t > state.t + eps) : [...steps].reverse().find((x) => x.t < state.t - eps);
    if (s) seek(s.t);
    else if (dir < 0) seek(0);
  }

  /* ---------- Рисуване ---------- */
  function render(force) {
    const t = state.t;
    const now = L.timecode === 'ae' ? tc(t) : fmt(t);
    timeEl.innerHTML = `${now}<span class="dur"> / ${L.timecode === 'ae' ? tc(D) : fmt(D)}</span>`;
    stageTime.textContent = state.page ? '' : fmt(t);
    fill.style.width = pct(t);
    scrub.setAttribute('aria-valuenow', Math.round(t));
    scrub.setAttribute('aria-valuetext', fmt(t));
    const r0 = tracks[0].getBoundingClientRect(), host = tlBody.getBoundingClientRect();
    playhead.style.left = `${r0.left - host.left + (t / D) * r0.width}px`;
    playhead.firstChild.textContent = fmt(t);
    playhead.classList.toggle('at-start', (t / D) * r0.width < 28);

    const ch = state.page || currentChapter();
    stageSub.textContent = ch ? ch.title : '';
    if (!state.page && ch) state.visited.add(ch.i);
    if (ch && state.lastCh !== ch) { state.lastCh = ch; tabEls[ch.i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    chapters.forEach((c, k) => {
      const cur = c === ch;
      tabEls[k].setAttribute('aria-current', cur ? 'true' : 'false');
      stepEls[k].setAttribute('aria-current', cur ? 'true' : 'false');
      const done = c.video && !cur && c.end <= t;
      stepEls[k].classList.toggle('done', done);
      stepEls[k].querySelector('.dot').outerHTML = !c.video ? icon.page : cur ? icon.now : done ? icon.done : icon.todo;
    });
    bandEls.forEach(([b, c]) => b.classList.toggle('current', c === ch && !state.page));
    rowEls.forEach(([r, c]) => r.classList.toggle('current', c === ch && !state.page));
    const curStep = [...steps].reverse().find((s) => s.t <= t + 0.05);
    // Понятието, чийто момент видеото показва сега (6 секунди след момента)
    termEls.forEach(([n, at]) => n.classList.toggle('now', !state.page && t >= at && t < at + 6));
    markEls.forEach(([m, s]) => {
      m.classList.toggle('current', s === curStep);
      m.classList.toggle('in-ch', !!ch?.video && !state.page && s.t >= ch.start && s.t < ch.end);
    });
    // Пристигане на стъпка: еднократен кръг около маркера и етикетът се плъзга под него
    if (curStep !== state.pingStep) {
      state.pingStep = curStep;
      markEls.forEach(([m]) => m.classList.remove('ping'));
      const hit = markEls.find(([, s]) => s === curStep);
      if (hit && !state.page) restart(hit[0], 'ping');
    }

    const act = state.page ? [] : activeCues();
    if (hasCtx) { ctx.hidden = !!state.page; if (!state.page) renderCtx(ch, act); }
    const sig = act.map((c) => c.i).join(',');
    if (sig !== state.sig || force) {
      const fresh = sig !== state.sig;
      state.sig = sig;
      overlay.replaceChildren();
      layer.replaceChildren();
      act.forEach((c) => {
        if (c.type === 'callout') drawCallout(c);
        else if (c.type === 'keys') drawKeys(c);
        else if (c.type === 'note') drawNote(c);
      });
      const pc = act.find((c) => c.type === 'panel');
      if (!state.page) openPanel(pc?.panel || ch?.panel, fresh);   // без бележка: панелът на главата; без него: последното обяснение
    }
  }

  /* ---------- Цикъл ---------- */
  let prev = performance.now();
  function loop(now) {
    const dt = Math.min((now - prev) / 1000, 0.1);
    prev = now;
    if (state.playing) {
      const before = state.t;
      state.t = video ? video.currentTime : Math.min(state.t + dt * state.rate, D);
      const stop = cues.find((c) => c.pause && before < c.t && state.t >= c.t);
      if (stop) { state.t = stop.t; if (video) video.currentTime = stop.t; setPlaying(false); }
      if (!video && state.t >= D) setPlaying(false);
      render(false);
    }
    requestAnimationFrame(loop);
  }

  /* ---------- Клавиатура и мишка ---------- */
  let dragging = false;
  const scrubTo = (e) => { const r = scrub.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * D); };
  scrub.addEventListener('pointerdown', (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); });
  scrub.addEventListener('pointermove', (e) => { if (dragging) scrubTo(e); });
  scrub.addEventListener('pointerup', () => { dragging = false; });
  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { seek(state.t - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { seek(state.t + 5); e.preventDefault(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea') || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || e.code === 'KeyK') { setPlaying(!state.playing); e.preventDefault(); }
    else if (k === 'ArrowLeft' && e.target !== scrub) seek(state.t - 5);
    else if (k === 'ArrowRight' && e.target !== scrub) seek(state.t + 5);
    else if (k === 'ArrowUp') { jumpStep(-1); e.preventDefault(); }
    else if (k === 'ArrowDown') { jumpStep(1); e.preventDefault(); }
    else if (e.code === 'KeyP') togglePin();
    else if (/^[1-9]$/.test(k) && chapters[+k - 1]) goChapter(chapters[+k - 1]);
  });
  addEventListener('resize', () => render(true));
  new ResizeObserver(() => { state.sig = ''; render(false); }).observe(frame);

  /* ---------- Разделител: височината на долната лента се влачи ---------- */
  const KEY = 'lesson-tl-h:' + (L.skin || 'x');
  const grip = el('div', { class: 'grip', role: 'separator', tabindex: 0, 'aria-orientation': 'horizontal', 'aria-label': 'Височина на долната лента', title: 'Влачи, за да смениш височината (двоен клик: начална)' });
  timeline.prepend(grip);
  const setTl = (px, save) => {
    const max = Math.round(innerHeight * 0.65), min = 110;
    px = Math.min(Math.max(Math.round(px), min), max);
    app.style.setProperty('--tl-h', px + 'px');
    grip.setAttribute('aria-valuenow', px);
    if (save) { try { localStorage.setItem(KEY, px); } catch {} }
    render(true);
  };
  try { const saved = +localStorage.getItem(KEY); if (saved) setTl(saved, false); } catch {}
  let dragTl = false;
  grip.addEventListener('pointerdown', (e) => { dragTl = true; grip.setPointerCapture(e.pointerId); app.classList.add('resizing'); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (dragTl) setTl(app.getBoundingClientRect().bottom - e.clientY - parseFloat(getComputedStyle(app).paddingBottom), false); });
  const endTl = () => { if (!dragTl) return; dragTl = false; app.classList.remove('resizing'); setTl(timeline.getBoundingClientRect().height, true); };
  grip.addEventListener('pointerup', endTl);
  grip.addEventListener('lostpointercapture', endTl);
  grip.addEventListener('pointercancel', endTl);
  grip.addEventListener('dblclick', () => { app.style.removeProperty('--tl-h'); try { localStorage.removeItem(KEY); } catch {} render(true); });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    setTl(timeline.getBoundingClientRect().height + (e.key === 'ArrowUp' ? 24 : -24), true);
  });

  /* ---------- Линк към момент: урок.html#t=42 ---------- */
  const fromHash = () => {
    const m = location.hash.match(/t=(\d+(?:\.\d+)?)/);
    if (m) seek(+m[1]);
  };
  addEventListener('hashchange', fromHash);

  /* ---------- Редакция на текста (само за собственика, в claude.ai) ----------
     Бутонът се появява, ако урокът е публикуван с capabilities {artifact: {}, user: {}} и зрителят може да го
     редактира. „Запази“ публикува страницата наново: шаблоните (<template>) с поправения текст и window.LESSON,
     написан наново от данните. Сървърът отказва запис на всеки, който не е редактор. */
  const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--') + "'";
  function lit(v, ind) {                         // window.LESSON като четим JS: къси обекти на един ред
    if (typeof v === 'string') return q(v);
    if (v === null || typeof v !== 'object') return String(v);
    const inner = ind + '  ';
    if (Array.isArray(v)) {
      const parts = v.map((x) => lit(x, inner));
      const one = '[' + parts.join(', ') + ']';
      return one.length <= 100 && !one.includes('\n') ? one : '[\n' + parts.map((p) => inner + p).join(',\n') + '\n' + ind + ']';
    }
    const parts = Object.keys(v).filter((k) => v[k] !== undefined).map((k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k)) + ': ' + lit(v[k], inner));
    const one = '{ ' + parts.join(', ') + ' }';
    return ind && one.length <= 140 && !one.includes('\n') ? one : '{\n' + parts.map((p) => inner + p).join(',\n') + '\n' + ind + '}';
  }
  function buildPage() {
    const body = [];
    for (const n of document.body.childNodes) {  // в публикуваната страница <title> и <link> също са в body: тях ги пише head
      if (n.nodeType === 8) body.push(`<!--${n.data}-->`);
      else if (n.nodeType !== 1) continue;
      else if (n === app) body.push('<div id="app" class="app"></div>');
      else if (n.tagName === 'TEMPLATE') body.push(n.outerHTML);
      else if (n.tagName === 'SCRIPT' && !n.hasAttribute('src') && /window\.LESSON\s*=/.test(n.textContent)) body.push(`<script>\nwindow.LESSON = ${lit(L, '')};\n</script>`);
      else if (n.tagName === 'SCRIPT' && n.getAttribute('src') === SRC.js) body.push(`<script src="${esc(SRC.js)}"></script>`);
    }
    const head = ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', `<title>${esc(SRC.title)}</title>`,
      ...SRC.css.map((h) => `<link rel="stylesheet" href="${esc(h)}">`)];
    return `${SKELETON}\n<!doctype html>\n<html lang="bg">\n<head>\n${head.join('\n')}\n</head>\n<body>\n${body.join('\n\n')}\n</body>\n</html>\n</body></html>`;
  }

  let artifact = null, dirty = false;
  const editStatus = el('span', { class: 'edit-status', 'aria-live': 'polite' });
  const editBtn = el('button', { class: 'edit-btn', title: 'Поправки в текста на урока', onclick: () => setEditing(true) }, '✎ Редакция');
  const cancelBtn = el('button', { class: 'edit-btn', hidden: true, onclick: cancelEdit }, 'Откажи');
  const saveBtn = el('button', { class: 'edit-btn primary', hidden: true, disabled: true, onclick: saveEdit }, 'Запази');
  const editBar = el('div', { class: 'edit-bar', hidden: true }, editStatus, editBtn, cancelBtn, saveBtn);
  top.append(editBar);

  function setEditing(on) {
    state.editing = on;
    app.classList.toggle('editing', on);
    editBtn.hidden = on; cancelBtn.hidden = saveBtn.hidden = !on;
    editStatus.textContent = on ? 'Кликнете в текста и пишете.' : '';
    if (on) setPlaying(false);
    if (state.panelId) editable(pBody, tplWriter(state.panelId));
    if (state.page) editable(page.firstChild, tplWriter(state.page.page));
    state.ctxSig = '';
    render(true);
  }
  function cancelEdit() {
    if (!dirty) { setEditing(false); return; }
    if (cancelBtn.dataset.sure == null) {         // втори клик потвърждава: поправките се губят
      cancelBtn.dataset.sure = '';
      cancelBtn.textContent = 'Без запис? Да';
      setTimeout(() => { delete cancelBtn.dataset.sure; cancelBtn.textContent = 'Откажи'; }, 4000);
      return;
    }
    dirty = false;
    location.reload();
  }
  async function saveEdit() {
    saveBtn.disabled = cancelBtn.disabled = true;
    editStatus.textContent = 'Записвам…';
    try {
      dirty = false;
      await artifact.publish(buildPage());
      editStatus.textContent = 'Запазено. Страницата се презарежда…';
    } catch (err) {
      dirty = true;
      saveBtn.disabled = cancelBtn.disabled = false;
      const c = err?.code;
      editStatus.textContent =
        c === 'conflict' ? 'Страницата е сменена междувременно и се презарежда; тази поправка не е запазена.' :
        ['not_writer', 'not_granted', 'not_declared', 'capability_disabled', 'capability_removed', 'consent_required'].includes(c) ? 'Тази страница е само за четене.' :
        c === 'too_large' ? 'Страницата е твърде голяма за запис.' :
        c === 'rate_limited' ? 'Много записи подред. Опитайте след малко.' : 'Записът не стана. Опитайте пак.';
    }
  }
  app.addEventListener('input', (e) => {
    const w = writers.get(e.target);
    if (!w) return;
    w(e.target);
    if (!dirty) { dirty = true; saveBtn.disabled = false; editStatus.textContent = 'Има незаписани поправки.'; }
  });
  app.addEventListener('paste', (e) => {          // само текст: без чужди шрифтове и стилове
    if (!e.target.closest?.('[contenteditable]')) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  app.addEventListener('keydown', (e) => {        // понятията и клавишите са на един ред
    if (e.key === 'Enter' && e.target.dataset?.plain != null && e.target.isContentEditable) { e.preventDefault(); e.target.blur(); }
  });
  addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  (async () => {
    if (typeof window.claude?.use !== 'function') return;
    try {
      const [a, user] = await Promise.all([claude.use('artifact'), claude.use('user')]);
      if (a && (await user?.canEdit())) { artifact = a; editBar.hidden = false; }
    } catch {}
  })();

  instant(() => { render(true); fromHash(); });
  requestAnimationFrame(loop);
})();
