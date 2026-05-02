// word-count plugin — registers a panel that shows aggregate word count
// across the active session's chunks. apiVersion 1.0.

self.manifest = { id: 'word-count', apiVersion: '1.0', displayName: 'Word Count' };

let totalWords = 0;
const sub = pluginAPI.subscribeStoreSlice('activeSession', { intervalMs: 1500 });

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'subscription' && msg.subscriptionId === sub.id) {
    const detail = msg.payload;
    totalWords = (detail?.chunks ?? []).reduce((sum, chunk) => {
      const text = JSON.stringify(chunk);
      return sum + text.split(/\s+/).filter(Boolean).length;
    }, 0);
    pluginAPI.registerPanel({
      id: 'word-count-panel',
      title: 'Word Count',
      html: `<div style="font-family: ui-sans-serif; padding: 8px;">Words: <strong>${totalWords}</strong></div>`,
    });
  }
});
