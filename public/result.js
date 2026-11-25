(() => {
  const token = location.pathname.split('/').pop();
  const $ = (s) => document.querySelector(s);
  const body = $('#r-body');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const HE = ''; // output is English now; kept as a hook if a store needs another language
  let waited = 0;

  const head = (h, sub) => { $('#r-heading').textContent = h; $('#r-sub').textContent = sub || ''; };

  async function load() {
    const r = await fetch(`/api/order/${token}`);
    if (!r.ok) { head('Link not found', 'Check that you copied the whole address from the email.'); $('#plan-label').textContent = ''; return; }
    const o = await r.json();
    $('#plan-label').textContent = o.planLabel;

    if (o.status === 'pending') {
      // The page waits for the provider's webhook, not for the redirect.
      head('Waiting for payment confirmation', 'This usually takes a few seconds. The page updates by itself.');
      body.innerHTML = '<p class="notice info"><span class="spinner" aria-hidden="true" style="display:inline-block;vertical-align:middle;margin-inline-end:8px"></span>Waiting for the card processor to confirm…</p>';
      waited += 2;
      if (waited > 120) body.innerHTML = "<p class=\"notice error\">The confirmation hasn't arrived yet. If you were charged, we'll email the link as soon as the payment is confirmed.</p>";
      else setTimeout(load, 2000);
      return;
    }
    if (o.status === 'refunded') { head('Order cancelled', 'This order was refunded.'); body.innerHTML = ''; return; }

    if (o.plan === 'single') return renderSingle(o);
    return renderBatch(o);
  }

  function copyBtn(text) {
    return `<button class="btn btn-ghost btn-sm copy-btn" data-copy="${esc(text)}">Copy</button>`;
  }
  function count(text, max) {
    const n = [...text].length;
    return `<span class="count ${n > max ? 'over' : ''}">${n}/${max} characters</span>`;
  }

  function renderSingle(o) {
    const r = o.result;
    head('Your full page', `Also sent to ${o.email}. This link is permanent, you can come back to it.`);
    const bulletsText = r.bullets.map((b) => `• ${b}`).join('\n');
    const imgs = o.source.images || [];
    body.innerHTML = `
      <div class="toolbar" style="margin-bottom:18px">
        <a class="btn btn-accent" href="/api/order/${token}/csv">Download CSV for Shopify</a>
        ${o.source.url ? `<a class="btn btn-ghost" href="${esc(o.source.url)}" target="_blank" rel="noopener">Original product page</a>` : ''}
      </div>
      <div class="fields">
        <section class="rfield"><div class="rfield-top"><h2>Title</h2><div>${count(r.title, 60)} ${copyBtn(r.title)}</div></div><div class="val" ${HE}>${esc(r.title)}</div></section>
        <section class="rfield"><div class="rfield-top"><h2>Intro</h2>${copyBtn(r.intro)}</div><div class="val" ${HE}>${esc(r.intro)}</div></section>
        <section class="rfield"><div class="rfield-top"><h2>Spec bullets</h2>${copyBtn(bulletsText)}</div><ul ${HE}>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>
        <section class="rfield"><div class="rfield-top"><h2>Meta description</h2><div>${count(r.meta, 155)} ${copyBtn(r.meta)}</div></div><div class="val" ${HE}>${esc(r.meta)}</div></section>
        ${r.alts.length ? `<section class="rfield"><div class="rfield-top"><h2>Image alt text</h2></div>
          ${r.alts.map((a, i) => `<div class="alt-row">${imgs[i] ? `<img src="${esc(imgs[i].src)}" alt="" loading="lazy">` : ''}<span ${HE}>${esc(a)}</span>${copyBtn(a)}</div>`).join('')}</section>` : ''}
        ${r.missing_info.length ? `<section class="rfield"><div class="rfield-top"><h2>Missing info shoppers look for</h2></div>
          <ul ${HE}>${r.missing_info.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          <p class="fine" style="margin:10px 0 0">Worth adding the answers to your description. We didn't write them ourselves because they weren't in your data.</p></section>` : ''}
      </div>`;
  }

  function renderBatch(o) {
    if (o.batchStatus === 'awaiting_upload') {
      head('Upload your products file', `Your package covers up to ${o.quota} products.`);
      body.innerHTML = `
        <div class="rfield" style="margin-bottom:60px">
          <p style="margin-top:0">Shopify: Products, then Export, and choose CSV. WooCommerce: Products, then Export. Upload the file here as it is.</p>
          <form id="up-form">
            <div class="field"><label for="csv">CSV file</label><input id="csv" type="file" accept=".csv,text/csv" required></div>
            <div class="toolbar"><button class="btn btn-accent" id="up-btn">Upload and start</button></div>
            <div id="up-status" role="status" aria-live="polite"></div>
          </form>
        </div>`;
      $('#up-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = $('#csv').files[0];
        const st = $('#up-status');
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { st.innerHTML = '<p class="notice error">The file is larger than 5MB</p>'; return; }
        $('#up-btn').disabled = true;
        const r = await fetch(`/api/order/${token}/upload`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: await f.text() });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { st.innerHTML = '<p class="notice error"></p>'; st.firstChild.textContent = j.error || 'The upload failed'; $('#up-btn').disabled = false; return; }
        load();
      });
      return;
    }

    const c = o.counts || {};
    if (o.batchStatus === 'processing') {
      head('Writing your products', `${c.done || 0} of ${c.total} ready. We'll email ${o.email} when everything is done, so you can close this page.`);
      setTimeout(load, 4000);
    } else {
      head('Your catalog is ready', o.batchNote || '');
    }
    body.innerHTML = `
      <div class="toolbar" style="margin-bottom:18px">
        <a class="btn btn-accent" href="/api/order/${token}/csv">Download CSV for Shopify${o.batchStatus === 'processing' ? ' (what is ready so far)' : ''}</a>
      </div>
      <div class="rfield" style="margin-bottom:60px;overflow-x:auto">
        <table class="table-simple">
          <thead><tr><th>Product</th><th>New title</th><th>Meta description</th><th>Status</th></tr></thead>
          <tbody>${o.items.map((i) => `<tr>
            <td>${esc(i.title)}</td>
            <td ${HE}>${i.result ? `${esc(i.result.title)} ${copyBtn(i.result.title)}` : ''}</td>
            <td ${HE}>${i.result ? esc(i.result.meta) : ''}</td>
            <td><span class="status-pill ${i.status === 'done' ? 'ok' : i.status === 'failed' ? 'bad' : ''}">${{ done: 'Ready', failed: 'Failed', queued: 'Queued', working: 'Writing' }[i.status] || i.status}</span></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch {
      const t = document.createElement('textarea'); t.value = b.dataset.copy; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    const old = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = old), 1500);
  });

  load();
})();
