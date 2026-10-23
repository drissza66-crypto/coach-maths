import type { ReactNode } from 'react';
import { MASTERY_LABELS, type MasteryStatus } from '@mathsuivi/shared';

/** 0,5 → « 50 % » ; null → tiret (pas de donnée). */
export const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)} %`);

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

/**
 * Jauge d'un taux : la valeur est toujours écrite à côté (la barre est décorative).
 */
export function Meter({ value }: { value: number | null }) {
  return (
    <span className="meter-cell">
      <span className="meter" aria-hidden="true">
        {value !== null && <span className="meter-fill" style={{ width: `${Math.round(value * 100)}%` }} />}
      </span>
      <span className="meter-value">{pct(value)}</span>
    </span>
  );
}

const STATUS_STYLE: Record<MasteryStatus, { cls: string; icon: string }> = {
  acquis: { cls: 'badge-ok', icon: '✓' },
  en_cours: { cls: 'badge-wait', icon: '◐' },
  a_retravailler: { cls: 'badge-ko', icon: '!' },
  peu_de_donnees: { cls: 'badge-neutral', icon: '…' },
};

/** Statut de maîtrise : symbole + texte, jamais la couleur seule. */
export function MasteryBadge({ statut }: { statut: MasteryStatus }) {
  const s = STATUS_STYLE[statut];
  return (
    <span className={`badge ${s.cls}`}>
      <span aria-hidden="true">{s.icon} </span>
      {MASTERY_LABELS[statut]}
    </span>
  );
}

/** Tableau qui défile horizontalement dans son cadre sur petit écran (jamais la page). */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
