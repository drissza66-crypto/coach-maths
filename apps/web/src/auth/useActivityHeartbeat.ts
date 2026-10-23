import { useEffect } from 'react';
import { ACTIVITY_PING_SECONDS } from '@mathsuivi/shared';

const IDLE_MS = 2 * 60 * 1000;

/**
 * Temps passé : une minute est comptée seulement si la page est visible
 * et que l'apprenti a bougé, tapé ou fait défiler dans les 2 dernières minutes.
 * Rien d'autre n'est envoyé (ni page, ni clic, ni heure précise).
 */
export function useActivityHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let lastInteraction = Date.now();
    const touch = () => {
      lastInteraction = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastInteraction > IDLE_MS) return;
      fetch('/api/activite', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    }, ACTIVITY_PING_SECONDS * 1000);

    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [enabled]);
}
