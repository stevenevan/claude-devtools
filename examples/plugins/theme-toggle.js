// theme-toggle plugin — registers a command that flips dark/light mode.
// apiVersion 1.0. The host wires the handler key to a privileged
// theme-toggle action exposed to plugins.

self.manifest = { id: 'theme-toggle', apiVersion: '1.0', displayName: 'Theme Toggle' };

pluginAPI.registerCommand({
  id: 'theme-toggle.flip',
  label: 'Flip Theme (dark ↔ light)',
  handlerKey: 'flip-theme',
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg && msg.type === 'command-invoked' && msg.handlerKey === 'flip-theme') {
    postMessage({ type: 'theme-flip-request' });
  }
});
