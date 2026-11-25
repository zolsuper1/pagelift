// Background processing of CSV batches (pilot / catalog plans). Runs in-process and resumes after restart.
import { db } from './db.js';
import { generateCopy } from './generate.js';
import { sendMail } from './email.js';
import { config } from './config.js';

const CONCURRENCY = 2;
let running = 0;
let timer = null;

export function kickBatchWorker() {
  if (!timer) timer = setInterval(tick, 2000);
  tick();
}

function tick() {
  while (running < CONCURRENCY) {
    const item = db.prepare(`
      SELECT bi.* FROM batch_items bi JOIN orders o ON o.id = bi.order_id
      WHERE bi.status = 'queued' AND o.status = 'paid' ORDER BY bi.id LIMIT 1`).get();
    if (!item) break;
    db.prepare(`UPDATE batch_items SET status = 'working' WHERE id = ? AND status = 'queued'`).run(item.id);
    running++;
    processItem(item).finally(() => { running--; finishOrders(); });
  }
}

async function processItem(item) {
  try {
    const result = await generateCopy(JSON.parse(item.source_json));
    db.prepare(`UPDATE batch_items SET status = 'done', result_json = ? WHERE id = ?`).run(JSON.stringify(result), item.id);
  } catch (e) {
    console.error('batch item failed', item.id, e.message);
    db.prepare(`UPDATE batch_items SET status = 'failed', error = ? WHERE id = ?`).run(String(e.message).slice(0, 500), item.id);
  }
}

function finishOrders() {
  const orders = db.prepare(`SELECT * FROM orders WHERE batch_status = 'processing'`).all();
  for (const o of orders) {
    const c = db.prepare(`SELECT
        SUM(status IN ('queued','working')) AS pending,
        SUM(status = 'done') AS done, SUM(status = 'failed') AS failed
      FROM batch_items WHERE order_id = ?`).get(o.id);
    if (c.pending > 0) continue;
    const r = db.prepare(`UPDATE orders SET batch_status = 'done', batch_note = ? WHERE id = ? AND batch_status = 'processing'`)
      .run(`${c.done} done, ${c.failed} failed`, o.id);
    if (r.changes) {
      sendMail(o.email, 'Your catalog is ready – Pagelift', [
        'Hi,',
        `Your file is done: ${c.done} products ready${c.failed ? `, ${c.failed} could not be processed (we'll look into it and get back to you)` : ''}.`,
        'See the results and download a CSV to import into Shopify here:',
      ], `${config.baseUrl}/r/${o.access_token}`).catch((e) => console.error('mail failed', e.message));
    }
  }
}

// On startup, anything left "working" from a crash goes back to the queue.
db.prepare(`UPDATE batch_items SET status = 'queued' WHERE status = 'working'`).run();
