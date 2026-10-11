// Tauri builds don't ship a service worker.
export function registerSW(_o?: unknown) {
  return (_reload?: boolean) => {};
}
