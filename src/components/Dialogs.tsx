import { Archive, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Language, Suggestion } from '../../shared';
import { formatBytes, formatDate, formatDateTime } from '../format';
import { serverText, translator } from '../i18n';

interface DialogProps {
  demoMode: boolean;
  busy: boolean;
  close: () => void;
  confirm: () => void;
  language: Language;
}

function Modal({ close, children }: { close: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="modal">
        <button className="modal-close" onClick={close}><X size={18} /></button>
        <div className="modal-warning"><Trash2 size={22} /></div>
        {children}
      </div>
    </div>
  );
}

function Actions({ busy, close, confirm, confirmLabel, language }: Omit<DialogProps, 'demoMode'> & { confirmLabel: string }) {
  const t = translator(language);
  return (
    <div className="modal-actions">
      <button className="secondary-button" onClick={close} disabled={busy}>{t('cancel')}</button>
      <button className="destructive-button" onClick={confirm} disabled={busy}><Trash2 size={15} />{busy ? t('working') : confirmLabel}</button>
    </div>
  );
}

export function RemoveDialog({ suggestion, demoMode, busy, close, confirm, language }: DialogProps & { suggestion: Suggestion }) {
  const t = translator(language);
  const provider = suggestion.mediaKind === 'movie' ? 'TMDB' : 'TVDB';
  const match = suggestion.matchMethod === 'external-id'
    ? t('exactMatch', { provider })
    : suggestion.matchMethod === 'title-year' ? t('fallbackMatch') : t('noConfirmedMatch');
  const explanation = demoMode ? t('demoAction') : suggestion.mediaKind === 'movie' ? t('movieAction') : t('seriesAction');

  return (
    <Modal close={close}>
      <div className="eyebrow">{t('manualReview')}</div>
      <h2>{suggestion.title}</h2>
      <p className="modal-subtitle">{t('requestedBy', { subtitle: serverText(suggestion.subtitle, language), requester: suggestion.requester })}</p>
      <div className="evidence">
        <div><span>{t('cleanupReason')}</span><strong>{serverText(suggestion.reason, language)}</strong></div>
        <div><span>{t('requested')}</span><strong>{formatDate(suggestion.requestedAt, language)}</strong></div>
        <div><span>{t('availableSince')}</span><strong>{formatDate(suggestion.availableSince, language)}</strong></div>
        <div><span>{t('lastWatched')}</span><strong>{formatDateTime(suggestion.lastWatchedAt, language)}</strong></div>
        <div><span>{t('match')}</span><strong>{match}</strong></div>
      </div>
      <div className="action-explainer"><Archive size={17} /><span>{explanation}</span></div>
      <Actions busy={busy} close={close} confirm={confirm} language={language} confirmLabel={demoMode ? t('confirmDemo') : t('removeMediaAndRequest')} />
    </Modal>
  );
}

export function BulkRemoveDialog({ suggestions, demoMode, busy, close, confirm, language }: DialogProps & { suggestions: Suggestion[] }) {
  const t = translator(language);
  return (
    <Modal close={close}>
      <div className="eyebrow">{t('bulkReview')}</div>
      <h2>{t('removeMultiple', { count: suggestions.length })}</h2>
      <p className="modal-subtitle">{t('bulkRemovalDescription')}</p>
      <div className="bulk-review-list">
        {suggestions.map((item) => (
          <div key={item.id}>
            <strong>{item.title}</strong>
            <span>{serverText(item.subtitle, language)} · {item.requester} · {formatBytes(item.fileSizeBytes, language)}</span>
          </div>
        ))}
      </div>
      <div className="action-explainer"><Archive size={17} /><span>{t(demoMode ? 'demoAction' : 'bulkRemovalAction')}</span></div>
      <Actions busy={busy} close={close} confirm={confirm} language={language} confirmLabel={demoMode ? t('confirmDemo') : t('removeSelectedConfirm', { count: suggestions.length })} />
    </Modal>
  );
}
