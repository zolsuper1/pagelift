import nodemailer from 'nodemailer';
import { config } from './config.js';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendMail(to, subject, lines, link) {
  const text = [...lines, link ? `\n${link}` : ''].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#263236">
${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#ffb547;color:#17123b;font-weight:bold;padding:12px 20px;border-radius:999px;text-decoration:none">Open your result</a></p><p style="font-size:13px;color:#59625d">${esc(link)}</p>` : ''}
</div>`;
  if (!transport) {
    console.log(`\n[email -> ${to}] ${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
}
