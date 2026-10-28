/* global chrome, document, setTimeout, Blob, URL */

const $ = (x) => document.getElementById(x);
async function tab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
async function send(m) {
  const t = await tab();
  return chrome.tabs.sendMessage(t.id, m);
}
async function refresh() {
  const s = await chrome.storage.local.get('xHistoryPosts');
  $('count').textContent = (s.xHistoryPosts || []).length;
}
$('start').onclick = async () => {
  try {
    await send({ type: 'START', autoScroll: $('auto').checked });
    $('status').textContent = 'Collecte active';
    setTimeout(refresh, 500);
  } catch {
    $('status').textContent = 'Recharge X';
  }
};
$('stop').onclick = async () => {
  try {
    await send({ type: 'STOP' });
  } catch {
    /* The current tab may have closed. */
  }
  refresh();
};
$('library').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
refresh();

// Read only posts, never openaiKey or other extension storage.
$('export').onclick = async () => {
  try {
    const { xHistoryPosts = [] } = await chrome.storage.local.get('xHistoryPosts');
    if (!Array.isArray(xHistoryPosts)) throw new Error('Format de stockage inconnu');
    const allowed = [
      'post_id',
      'text',
      'quoted_text',
      'quoted_url',
      'author_name',
      'author_handle',
      'datetime',
      'captured_at',
      'url',
      'external_links',
      'manual_category',
      'manual_tags',
    ];
    const posts = xHistoryPosts.map((p) =>
      Object.fromEntries(allowed.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])),
    );
    const blob = new Blob([JSON.stringify({ version: 'v12-export.v1', posts }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'knowledge-x-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('status').textContent =
      posts.length + ' publications exportées. Le fichier contient vos textes : gardez-le privé.';
  } catch {
    $('status').textContent = 'Export impossible. Les données de l’extension restent conservées.';
  }
};
