// Before/after slider, reviews carousel, client logos. No dependencies.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- Before / after slider ----------------
     The "after" page sits on top and is clipped from the left at the handle position.
     Mouse: the handle follows the pointer's x across the page (eased, not snapped).
     Touch: drag horizontally; vertical swipes still scroll the page (touch-action: pan-y).
     Keyboard / screen readers: the range input drives the same position. */
  const stage = document.getElementById('compare-stage');
  if (stage) {
    const range = document.getElementById('compare-range');
    let current = 50, target = 50, raf = 0, touched = false, reported = false;
    // Funnel: does anyone actually use the main demo? Reported once per page view.
    const used = () => { touched = true; if (reported) return; reported = true; fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'compare_used', path: location.pathname }), keepalive: true }).catch(() => {}); };

    const paint = () => { stage.style.setProperty('--pos', current.toFixed(2) + '%'); range.value = Math.round(current); };
    const tick = () => {
      const d = target - current;
      current = Math.abs(d) < 0.05 ? target : current + d * (reduce ? 1 : 0.16);
      paint();
      raf = current === target ? 0 : requestAnimationFrame(tick);
    };
    const go = (pct) => { target = Math.max(0, Math.min(100, pct)); if (!raf) raf = requestAnimationFrame(tick); };
    const fromEvent = (e) => { const r = stage.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * 100; };

    // Phones: a Before / After switch instead of a split page, which cuts both texts mid-word.
    const narrow = window.matchMedia('(max-width: 760px)');
    const toggles = [...document.querySelectorAll('.compare-toggle button')];
    const showSide = (side) => {
      cancelAnimationFrame(raf); raf = 0;
      current = target = side === 'after' ? 0 : 100; paint();
      toggles.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.show === side)));
    };
    toggles.forEach((b) => b.addEventListener('click', () => { used(); showSide(b.dataset.show); }));
    narrow.addEventListener('change', (e) => (e.matches ? showSide('before') : go(50)));

    stage.addEventListener('pointermove', (e) => {
      if (narrow.matches) return;
      if (e.pointerType === 'mouse' || e.buttons) { used(); go(fromEvent(e)); }
    });
    stage.addEventListener('pointerdown', (e) => { if (narrow.matches) return; used(); go(fromEvent(e)); });
    range.addEventListener('input', () => { used(); target = current = Number(range.value); paint(); });
    paint();
    if (narrow.matches) showSide('before');

    // One authored moment: the first time the page scrolls into view, sweep once to show it moves.
    if (!reduce && !narrow.matches && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const steps = [[350, 80], [1250, 22], [2100, 50]];
        steps.forEach(([ms, pct]) => setTimeout(() => { if (!touched) go(pct); }, ms));
      }, { threshold: 0.55 });
      io.observe(stage);
    }
  }

  /* ---------------- Reviews carousel ----------------
     Reads /reviews.json. Real entries show on the live page; entries marked "sample": true
     show only with ?reviews=sample, so placeholder copy never reaches visitors. */
  const reviewsSec = document.getElementById('reviews');
  if (reviewsSec) {
    const showSamples = new URLSearchParams(location.search).get('reviews') === 'sample';
    fetch('/reviews.json').then((r) => (r.ok ? r.json() : [])).then((all) => {
      const items = (Array.isArray(all) ? all : []).filter((r) => (showSamples ? true : !r.sample) && r.quote && r.name);
      if (!items.length) return;
      const track = document.getElementById('reviews-track');
      track.innerHTML = items.map((r, i) => `
        <li class="review sheet" aria-roledescription="slide" aria-label="${i + 1} of ${items.length}">
          <span class="tape tape-top" aria-hidden="true"></span>
          <blockquote><p>${esc(r.quote)}</p></blockquote>
          <p class="review-by"><b>${esc(r.name)}</b>${r.store ? `, ${r.url ? `<a href="${esc(r.url)}" rel="noopener" target="_blank">${esc(r.store)}</a>` : esc(r.store)}` : ''}</p>
        </li>`).join('');
      reviewsSec.hidden = false;
      document.getElementById('reviews-sample-note').hidden = !showSamples;
      const step = () => (track.querySelector('.review')?.getBoundingClientRect().width || 320) + 24;
      document.getElementById('reviews-prev').addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduce ? 'auto' : 'smooth' }));
      document.getElementById('reviews-next').addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduce ? 'auto' : 'smooth' }));
    }).catch(() => {});
  }

  /* ---------------- Client logos ----------------
     Reads /clients.json: [{ "name": "...", "logo": "/clients/x.svg", "url": "https://..." }].
     Only list stores that are real customers and agreed to be shown. Empty list = section stays hidden. */
  const clientsSec = document.getElementById('clients');
  if (clientsSec) {
    fetch('/clients.json').then((r) => (r.ok ? r.json() : [])).then((list) => {
      if (!Array.isArray(list) || !list.length) return;
      const item = (c) => `<li>${c.logo ? `<img src="${esc(c.logo)}" alt="${esc(c.name)}" loading="lazy">` : `<span>${esc(c.name)}</span>`}</li>`;
      const track = document.getElementById('clients-track');
      // Two copies make the loop seamless; the second is hidden from screen readers.
      track.innerHTML = list.map(item).join('');
      clientsSec.hidden = false;
      // Scroll only when the logos don't fit; a short list stays a calm, static row.
      requestAnimationFrame(() => {
        if (track.scrollWidth <= track.parentElement.clientWidth) return;
        track.insertAdjacentHTML('beforeend', list.map(item).join('').replace(/<li>/g, '<li aria-hidden="true">'));
        track.classList.add('is-scrolling');
      });
    }).catch(() => {});
  }
})();
