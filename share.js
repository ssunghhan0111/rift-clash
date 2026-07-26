// RIFT CLASH — Share card
// ---------------------------------------------------------------------------
// After a Survival or Daily run, draw the result as a picture and hand it to
// whatever the device can actually share with. This is the growth loop: a bare
// URL pasted into a group chat gets ignored, a picture of "Wave 23, Dust Storm,
// 412 slain" gets a reply.
//
// Three routes out, best first:
//   1. navigator.share with the PNG attached — the native sheet on iPad/phone
//   2. clipboard.write with the PNG — one paste into Discord or iMessage
//   3. download the PNG, and copy a Wordle-style text block as a fallback
//
// Everything is drawn on a canvas here rather than fetched, so it works offline
// and costs the server nothing.
window.RC = window.RC || {};

RC.Share = (function () {
  const W = 1000, H = 560;

  function siteUrl() {
    try {
      if (location.protocol === 'file:') return 'riftclash.onrender.com';
      return location.host + (location.pathname.replace(/\/index\.html$/, '/') || '/');
    } catch (e) { return 'riftclash.onrender.com'; }
  }

  // ── the picture ──────────────────────────────────────
  function drawCard(run) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');

    // backdrop
    const sky = x.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, W * 0.8);
    sky.addColorStop(0, '#1e2c3d');
    sky.addColorStop(1, '#080c12');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    let s = 1337;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    x.fillStyle = '#cfdcea';
    for (let i = 0; i < 60; i++) {
      x.globalAlpha = 0.15 + rnd() * 0.5;
      x.beginPath(); x.arc(rnd() * W, rnd() * H * 0.8, rnd() * 1.7 + 0.5, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    // planet limb
    x.fillStyle = '#16263a';
    x.beginPath(); x.ellipse(W / 2, H + 250, W * 0.9, 330, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#2b4763'; x.lineWidth = 3; x.stroke();

    // header
    x.font = '700 34px ui-monospace, SF Mono, Consolas, monospace';
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#f08a2a'; x.fillText('RIFT', 56, 76);
    const rw = x.measureText('RIFT').width;
    x.fillStyle = '#3a7fd5'; x.fillText('CLASH', 56 + rw + 8, 76);
    x.font = '500 19px system-ui, sans-serif';
    x.fillStyle = '#7b8ea3';
    x.fillText(run.title || 'Survival', 56, 108);

    // the number that matters
    x.font = '700 150px ui-monospace, SF Mono, Consolas, monospace';
    x.fillStyle = '#ffffff';
    x.fillText('WAVE ' + (run.wave || 0), 52, 268);

    // supporting stats
    const stats = [];
    if (run.kills != null) stats.push(run.kills + ' slain');
    if (run.score != null) stats.push(run.score + ' points');
    if (run.race) stats.push(run.race);
    x.font = '500 26px system-ui, sans-serif';
    x.fillStyle = '#cfdcea';
    x.fillText(stats.join('   ·   '), 56, 318);

    // the twist / difficulty chip
    if (run.chip) {
      x.font = '700 22px system-ui, sans-serif';
      const tw = x.measureText(run.chip).width;
      x.fillStyle = '#2a2113';
      roundRect(x, 56, 344, tw + 34, 46, 9); x.fill();
      x.strokeStyle = '#ffc857'; x.lineWidth = 2; x.stroke();
      x.fillStyle = '#ffe9a8';
      x.fillText(run.chip, 73, 374);
    }

    // rank line, when we have one
    if (run.rankLine) {
      x.font = '600 23px system-ui, sans-serif';
      x.fillStyle = '#5ddc7a';
      x.fillText(run.rankLine, 56, 432);
    }

    // who, and where to play
    x.font = '600 24px system-ui, sans-serif';
    x.fillStyle = '#cfdcea';
    x.fillText(run.name || 'Anonymous', 56, H - 48);
    x.font = '500 21px system-ui, sans-serif';
    x.fillStyle = '#f08a2a';
    x.textAlign = 'right';
    x.fillText(siteUrl(), W - 56, H - 48);
    x.textAlign = 'left';

    return c;
  }
  function roundRect(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }

  // ── the text version (for places that only take text) ──
  function textFor(run) {
    const bar = '█'.repeat(Math.max(1, Math.min(12, Math.round((run.wave || 1) / 3)))) ;
    return 'RIFT CLASH — ' + (run.title || 'Survival') + '\n' +
           'Wave ' + (run.wave || 0) + '  ' + bar + '\n' +
           (run.kills != null ? run.kills + ' slain' : '') +
           (run.chip ? '  ·  ' + run.chip : '') + '\n' +
           'https://' + siteUrl();
  }

  function canvasToBlob(c) {
    return new Promise(res => {
      if (c.toBlob) c.toBlob(b => res(b), 'image/png');
      else res(null);
    });
  }

  // ── share ────────────────────────────────────────────
  // Returns a short word describing what actually happened, so the caller can
  // tell the player rather than leaving a button that seems to do nothing.
  async function share(run) {
    const c = drawCard(run);
    const text = textFor(run);
    const blob = await canvasToBlob(c);
    const file = (blob && typeof File !== 'undefined')
      ? new File([blob], 'rift-clash-wave-' + (run.wave || 0) + '.png', { type: 'image/png' })
      : null;

    // 1. the native share sheet, with the picture attached
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], text: text });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';   // the player closed the sheet
    }
    // 2. straight onto the clipboard as an image
    try {
      if (blob && navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        return 'copied-image';
      }
    } catch (e) { /* Firefox and Safari are picky here — fall through */ }
    // 3. text on the clipboard, and hand them the picture as a download
    let textOk = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        textOk = true;
      }
    } catch (e) {}
    download(c, run);
    return textOk ? 'downloaded-and-copied' : 'downloaded';
  }

  function download(c, run) {
    try {
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = 'rift-clash-wave-' + (run.wave || 0) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {}
  }

  // Can this device put the picture itself somewhere useful? Decides the label.
  function canShareImage() {
    try {
      if (navigator.share && navigator.canShare) return true;
      return !!(navigator.clipboard && window.ClipboardItem);
    } catch (e) { return false; }
  }

  return { drawCard, textFor, share, download, canShareImage, siteUrl };
})();
