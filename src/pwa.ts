/** Offer updates without interrupting a learning session. Persist state before calling apply. */
export async function registerPwa(onUpdate: (apply: () => void) => void): Promise<void> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) window.location.reload();
  });
  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    });
    function offer() {
      const waiting = registration.waiting;
      if (!waiting || !navigator.serviceWorker.controller) return;
      onUpdate(() => {
        applying = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
      });
    }
    offer();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer();
      });
    });
    const check = () => { void registration.update().catch(() => undefined); };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  } catch (error) {
    // Online use remains available. The interface must not claim offline readiness on failure.
    console.warn('オフライン機能を登録できませんでした', error);
  }
}
