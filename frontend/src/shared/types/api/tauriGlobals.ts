// Ambient declaration for the Tauri-injected window flag. Kept separate from
// contract types so the runtime-detection augmentation has its own home.

declare global {
  interface Window {
    __TAURI_INTERNALS__: unknown;
  }
}

export {};
