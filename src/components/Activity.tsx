import { Activity as ActivityIcon, Archive, History, RefreshCw, Settings, Trash2 } from 'lucide-react';
import type { ActivityItem, Language } from '../../shared';
import { formatDateTime } from '../format';
import { serverText, translator } from '../i18n';

const icons: Record<ActivityItem['type'], typeof Trash2> = { remove: Trash2, sync: RefreshCw, settings: Settings, dismiss: Archive };

export function Activity({ activity, language }: { activity: ActivityItem[]; language: Language }) {
  const t = translator(language);
  return (
    <>
      <section className="simple-head reveal">
        <div className="eyebrow"><ActivityIcon size={13} /> {t('activityLog')}</div>
        <h1>{t('activity')}</h1>
        <p>{t('activityDescription')}</p>
      </section>
      <section className="panel activity-panel reveal delay-1">
        <div className="timeline">
          {activity.length ? activity.map((item) => {
            const Icon = icons[item.type];
            return (
              <div className="timeline-item" key={item.id}>
                <div className={`timeline-icon ${item.outcome}`}><Icon size={15} /></div>
                <div>
                  <strong>{serverText(item.title, language)}</strong>
                  <p>{serverText(item.detail, language)}</p>
                </div>
                <time>{formatDateTime(item.createdAt, language)}</time>
              </div>
            );
          }) : (
            <div className="empty"><History size={23} /><strong>{t('noActivity')}</strong></div>
          )}
        </div>
      </section>
    </>
  );
}
