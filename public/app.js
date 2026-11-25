(() => {
  const $ = (s) => document.querySelector(s);
  const state = { cfg: null, genId: null, turnstileId: null, manual: false };
  const money = (n) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2 }));
  $('#year').textContent = new Date().getFullYear();

  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { data: j });
    return j;
  };
  const notice = (el, msg, kind = 'error') => { el.innerHTML = msg ? `<div class="notice ${kind}"></div>` : ''; if (msg) el.firstChild.textContent = msg; };
  const busy = (btn, on, label) => {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label}`; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  };

  // Analytics: page view
  fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'page_view', path: location.pathname }) }).catch(() => {});

  if (new URLSearchParams(location.search).get('payment') === 'failed') {
    notice($('#status'), "The payment didn't go through. You can try again.");
  }

  // Config + Turnstile
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    state.cfg = cfg;
    $('#contact-link').href = cfg.contactUrl;
    // Founding offer goes to the same inbox with its own subject line (or straight to a booking link).
    const fl = $('#founding-link');
    if (fl) fl.href = cfg.contactUrl.startsWith('mailto:') ? cfg.contactUrl.split('?')[0] + '?subject=' + encodeURIComponent('Founding store: 3 free pages') : cfg.contactUrl;
    // Prices come from the server, so the page always matches what checkout charges, per-product included.
    document.querySelectorAll('[data-price]').forEach((el) => {
      const p = cfg.plans?.[el.dataset.price];
      if (!p) return;
      el.textContent = money(p.price);
      const per = el.parentElement.querySelector('.per');
      if (per && p.quota > 1) per.textContent = `${money(Math.round((p.price / p.quota) * 100) / 100)} per product`;
    });
    if (cfg.turnstileSiteKey) {
      window.onTurnstileLoad = () => {
        state.turnstileId = window.turnstile.render('#turnstile', { sitekey: cfg.turnstileSiteKey, language: 'en', appearance: 'interaction-only' });
      };
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
      s.async = true;
      document.head.appendChild(s);
    }
  });
  const turnstileToken = () => (state.turnstileId !== null && window.turnstile ? window.turnstile.getResponse(state.turnstileId) : '');
  const resetTurnstile = () => { if (state.turnstileId !== null && window.turnstile) window.turnstile.reset(state.turnstileId); };

  // Manual mode
  const toggle = $('#manual-toggle');
  const setManual = (on) => {
    state.manual = on;
    $('#manual').hidden = !on;
    $('#preview-form').classList.toggle('is-manual', on);
    toggle.setAttribute('aria-expanded', String(on));
    toggle.textContent = on ? 'back to pasting a link' : 'or paste the text by hand';
    $('#url').closest('.url-row').querySelector('input').hidden = on;
    if (on) $('#m-title').focus(); else $('#url').focus();
  };
  toggle.addEventListener('click', () => setManual(!state.manual));

  // Preview
  $('#preview-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#preview-btn');
    const status = $('#status');
    notice(status, '');
    let body;
    if (state.manual) {
      const title = $('#m-title').value.trim();
      if (!title) return notice(status, 'Add at least the product title');
      body = { manual: { title, description: $('#m-desc').value.trim() } };
    } else {
      const url = $('#url').value.trim();
      if (!/^https?:\/\/\S+\.\S+/.test(url)) return notice(status, 'Paste the full link to a product page, starting with https://');
      body = { url };
    }
    body.turnstileToken = turnstileToken();
    busy(btn, true, 'Writing…');
    notice(status, 'Reading your product page and writing a new version. This takes up to a minute.', 'info');
    try {
      const r = await post('/api/preview', body);
      notice(status, '');
      showPreview(r);
    } catch (err) {
      notice(status, err.message);
      if (err.data?.manual && !state.manual) setManual(true);
    } finally {
      busy(btn, false);
      resetTurnstile();
    }
  });

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // Funnel events for links and buttons marked data-event (sample result, founding offer).
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-event]');
    if (el) fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: el.dataset.event, path: location.pathname }), keepalive: true }).catch(() => {});
  });

  function lines(n, widths) {
    return Array.from({ length: n }, (_, i) => `<div class="ph-line ph-bullet" style="width:${widths[i % widths.length]}%"></div>`).join('');
  }
  function showPreview(r) {
    state.genId = r.id;
    // Their own product next to ours: image, current title and current intro as the "Now" row.
    const src = r.source || {};
    const thumb = $('#pv-thumb');
    thumb.innerHTML = '';
    if (src.image) { const img = new Image(); img.alt = ''; img.loading = 'lazy'; img.src = src.image; img.onerror = () => img.remove(); thumb.appendChild(img); }
    thumb.classList.toggle('empty', !src.image);
    $('#pv-source').textContent = src.imageCount ? `${src.imageCount} image${src.imageCount === 1 ? '' : 's'} found on your page` : 'From the text you pasted';
    $('#pv-old-title').textContent = src.title || '';
    $('#pv-old-desc').textContent = src.description ? src.description + (src.description.length >= 220 ? '…' : '') : 'No description on the page yet.';
    $('#pv-title').textContent = r.preview.title;
    $('#pv-intro').textContent = r.preview.intro_first;
    $('#pv-checks').innerHTML = (r.checks || []).map((c) => `<li class="${c.ok ? 'ok' : 'warn'}"><span class="mark" aria-hidden="true"></span><span>${escapeHtml(c.label)}</span><b>${escapeHtml(c.detail)}</b></li>`).join('');
    // Placeholder bars only: the locked text is not in the page.
    $('#pv-bullets').innerHTML = lines(Math.max(r.locked.bullets, 3), [88, 74, 81, 66, 79]);
    $('#pv-bullets-label').textContent = `Spec bullets (${r.locked.bullets})`;
    const alts = r.locked.alts;
    $('#pv-alts-label').textContent = alts ? `Image alt text (${alts})` : 'Image alt text';
    $('#pv-alts').innerHTML = alts ? lines(Math.min(alts, 4), [60, 72, 54, 66]) : '<p class="fine">No images found on the page</p>';
    const pv = $('#preview');
    pv.hidden = false;
    pv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Unlock single product
  $('#unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#unlock-email').value.trim();
    const btn = $('#unlock-btn');
    const holder = e.currentTarget;
    holder.querySelector('.notice')?.remove();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      holder.insertAdjacentHTML('beforeend', '<div class="notice error">Enter a valid email. That\'s where we send the link to your result.</div>');
      return;
    }
    busy(btn, true, 'Opening payment page…');
    try {
      const r = await post('/api/checkout', { plan: 'single', generationId: state.genId, email });
      location.href = r.redirectUrl;
    } catch (err) {
      holder.insertAdjacentHTML('beforeend', `<div class="notice error"></div>`);
      holder.lastElementChild.textContent = err.message;
      busy(btn, false);
    }
  });

  // Pilot / catalog modal
  const modal = $('#plan-modal');
  let plan = null, lastFocus = null;
  const openModal = (p) => {
    plan = p;
    lastFocus = document.activeElement;
    const info = state.cfg?.plans?.[p];
    $('#plan-modal-title').textContent = info ? `${info.label}, ${money(info.price)}` : '';
    notice($('#plan-status'), '');
    modal.hidden = false;
    $('#plan-email').focus();
  };
  const closeModal = () => { modal.hidden = true; lastFocus?.focus(); };
  document.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.plan)));
  $('#plan-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  $('#plan-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#plan-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return notice($('#plan-status'), 'Enter a valid email');
    const btn = $('#plan-pay');
    busy(btn, true, 'Opening payment page…');
    try {
      const r = await post('/api/checkout', { plan, email });
      location.href = r.redirectUrl;
    } catch (err) {
      notice($('#plan-status'), err.message);
      busy(btn, false);
    }
  });
})();
