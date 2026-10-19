import { Archive, Check, ChevronRight, ExternalLink, Eye, EyeOff, Film, Gauge, RefreshCw, Search, Server, Tag, Trash2, Tv } from 'lucide-react';
import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useState } from 'react';
import type { Language, Overview, ServerStatistics, Suggestion, SuggestionStatus } from '../../shared';
import { formatBytes, formatDate, formatDateTime, formatNumber, formatRelative, statusLabel, suggestionGenres } from '../format';
import { serverText, translator } from '../i18n';

type SortOrder = 'requested-desc' | 'requested-asc' | 'title' | 'requester' | 'genre' | 'progress-desc';

interface DashboardProps {
  language: Language;
  overview: Overview;
  readyCount: number;
  partialCount: number;
  suggestions: Suggestion[];
  query: string;
  setQuery: (value: string) => void;
  genres: string[];
  genreFilter: string;
  setGenreFilter: (value: string) => void;
  sync: () => void;
  busy: boolean;
  onRemove: (item: Suggestion) => void;
  onDismiss: (item: Suggestion) => void;
  goSettings: () => void;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  openBulkDialog: () => void;
  seerrBaseUrl: string;
}

type TableShared = Pick<DashboardProps, 'onRemove' | 'onDismiss' | 'selectedIds' | 'setSelectedIds' | 'openBulkDialog' | 'seerrBaseUrl' | 'language'>;

export function Dashboard(props: DashboardProps) {
  const { language, overview, readyCount, partialCount, suggestions, query, setQuery, genres, genreFilter, setGenreFilter, sync, busy, goSettings } = props;
  const t = translator(language);
  const shared: TableShared = props;
  const openRequests = overview.suggestions.filter((item) => !['removed', 'dismissed'].includes(item.status)).length;

  return (
    <>
      <section className="page-head reveal">
        <div><p>{t('dashboardIntro')}</p></div>
        <div className="head-actions">
          <div className="sync-meta">
            <span>{t('lastScan')}</span>
            <strong>{formatRelative(overview.lastSyncAt, language)}</strong>
          </div>
          <button className="primary-button" onClick={sync} disabled={busy}>
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            {t(busy ? 'checking' : 'checkNow')}
          </button>
        </div>
      </section>

      {overview.demoMode && (
        <div className="demo-banner reveal delay-1">
          <div>
            <Gauge size={18} />
            <span><strong>{t('demoActive')}</strong> {t('demoNoChanges')}</span>
          </div>
          <button onClick={goSettings}>{t('configureServices')} <ChevronRight size={15} /></button>
        </div>
      )}

      <section className="metric-grid reveal delay-2">
        <Metric icon={<Archive size={18} />} label={t('openRequests')} value={openRequests} detail={t('fromSeerr')} />
        <Metric icon={<Check size={18} />} label={t('readyForReview')} value={readyCount} detail={t('watchedOrExpired')} accent />
        <Metric icon={<Eye size={18} />} label={t('stillWatching')} value={partialCount} detail={t('partiallyWatched')} />
        <ServerStatisticsMetric statistics={overview.serverStatistics} language={language} />
      </section>

      <section className="queue-toolbar panel reveal delay-3">
        <div>
          <h2>{t('requestsByStatus')}</h2>
          <p>{t('requestsByStatusDescription')}</p>
        </div>
        <div className="queue-filters">
          <label className="genre-filter">
            <Tag size={15} />
            <select aria-label={t('filterByGenre')} value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)}>
              <option value="">{t('allGenres')}</option>
              {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
            </select>
          </label>
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('titleOrUser')} />
          </label>
        </div>
      </section>

      <div className="table-stack reveal delay-3">
        <StatusTable {...shared} title={t('notWatched')} description={t('noCompletedView')} status="waiting" items={suggestions.filter((item) => item.status === 'waiting')} />
        <StatusTable {...shared} title={t('readyForReview')} description={t('fullyWatchedOrExpired')} status="ready" items={suggestions.filter((item) => item.status === 'ready')} />
        <StatusTable {...shared} title={t('beingWatched')} description={t('progressIncomplete')} status="partial" items={suggestions.filter((item) => item.status === 'partial')} />
      </div>
    </>
  );
}

function Metric({ icon, label, value, detail, accent = false }: { icon: ReactNode; label: string; value: number; detail: string; accent?: boolean }) {
  return (
    <div className={`metric ${accent ? 'metric-accent' : ''}`}>
      <div className="metric-top"><span>{label}</span>{icon}</div>
      <strong>{String(value).padStart(2, '0')}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ServerStatisticsMetric({ statistics, language }: { statistics?: ServerStatistics; language: Language }) {
  const t = translator(language);
  return (
    <div className="metric server-statistics-metric">
      <div className="metric-top"><span>{t('serverStatistics')}</span><Server size={18} /></div>
      <div className="server-statistics-grid">
        <div><small>{t('downloadedMovies')}</small><strong>{formatNumber(statistics?.movies, language)}</strong></div>
        <div><small>{t('downloadedEpisodes')}</small><strong>{formatNumber(statistics?.episodes, language)}</strong></div>
        <div><small>{t('freeSpace')}</small><strong>{formatBytes(statistics?.freeSpaceBytes, language)}</strong></div>
      </div>
    </div>
  );
}

function sortSuggestions(items: Suggestion[], order: SortOrder, language: Language): Suggestion[] {
  const byTitle = (a: Suggestion, b: Suggestion) => a.title.localeCompare(b.title, language);
  const firstGenre = (item: Suggestion) => suggestionGenres(item, language)[0] ?? '';
  return [...items].sort((a, b) => {
    switch (order) {
      case 'requested-asc': return a.requestedAt.localeCompare(b.requestedAt);
      case 'title': return byTitle(a, b);
      case 'requester': return a.requester.localeCompare(b.requester, language) || b.progress - a.progress || byTitle(a, b);
      case 'genre': return firstGenre(a).localeCompare(firstGenre(b), language) || byTitle(a, b);
      case 'progress-desc': return b.progress - a.progress || byTitle(a, b);
      default: return b.requestedAt.localeCompare(a.requestedAt);
    }
  });
}

function StatusTable({ title, description, status, items, onRemove, onDismiss, selectedIds, setSelectedIds, openBulkDialog, seerrBaseUrl, language }: TableShared & {
  title: string;
  description: string;
  status: SuggestionStatus;
  items: Suggestion[];
}) {
  const t = translator(language);
  const [order, setOrder] = useState<SortOrder>(status === 'ready' ? 'progress-desc' : 'requested-desc');
  const sorted = useMemo(() => sortSuggestions(items, order, language), [items, order, language]);
  const selectable = status === 'ready';
  const allSelected = selectable && sorted.length > 0 && sorted.every((item) => selectedIds.includes(item.id));
  const selectedCount = selectable ? items.filter((item) => selectedIds.includes(item.id)).length : 0;
  const toggleAll = () => setSelectedIds((current) => allSelected
    ? current.filter((id) => !sorted.some((item) => item.id === id))
    : [...new Set([...current, ...sorted.map((item) => item.id)])]);
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <section className={`panel status-table status-table-${status}`}>
      <div className="panel-head table-section-head">
        <div className="table-title">
          <span className={`table-status-mark ${status}`}><i /></span>
          <div>
            <h2>{title}<b>{items.length}</b></h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="table-head-actions">
          {selectedCount > 0 && (
            <button className="bulk-remove-button" onClick={openBulkDialog}>
              <Trash2 size={14} />{t('removeSelected', { count: selectedCount })}
            </button>
          )}
          <label className="sort-control">
            <span>{t('sort')}</span>
            <select aria-label={t('sortAria', { title })} value={order} onChange={(event) => setOrder(event.target.value as SortOrder)}>
              <option value="requested-desc">{t('newestRequest')}</option>
              <option value="requested-asc">{t('oldestRequest')}</option>
              <option value="title">{t('titleAz')}</option>
              <option value="requester">{t('requesterAz')}</option>
              <option value="genre">{t('genreAz')}</option>
              <option value="progress-desc">{t('mostProgress')}</option>
            </select>
          </label>
        </div>
      </div>
      <div className="request-table">
        <div className="table-header">
          <span className="content-heading">
            {selectable && <input className="row-checkbox" type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t('selectAll')} />}
            {t('content')}
          </span>
          <span>{t('requester')}</span>
          <span>{t('requested')}</span>
          <span>{t('watchStatus')}</span>
          <span>{t('lastTime')}</span>
          <span>{t('fileSize')}</span>
          <span>{t('status')}</span>
          <span>{t('actions')}</span>
        </div>
        {sorted.length ? sorted.map((item) => (
          <SuggestionRow
            key={item.id}
            item={item}
            onRemove={onRemove}
            onDismiss={onDismiss}
            selected={selectedIds.includes(item.id)}
            onToggle={() => toggle(item.id)}
            seerrBaseUrl={seerrBaseUrl}
            language={language}
          />
        )) : (
          <div className="empty compact"><Check size={21} /><strong>{t('emptyGroup')}</strong></div>
        )}
      </div>
    </section>
  );
}

function SuggestionRow({ item, onRemove, onDismiss, selected, onToggle, seerrBaseUrl, language }: {
  item: Suggestion;
  onRemove: (item: Suggestion) => void;
  onDismiss: (item: Suggestion) => void;
  selected: boolean;
  onToggle: () => void;
  seerrBaseUrl: string;
  language: Language;
}) {
  const t = translator(language);
  const seerrLink = seerrBaseUrl && item.tmdbId
    ? `${seerrBaseUrl.replace(/\/$/, '')}/${item.mediaKind === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`
    : undefined;
  const removeLabel = item.status === 'ready' ? t('reviewAndRemove') : t('deleteItem');

  return (
    <div className={`table-row ${item.status === 'removed' || item.status === 'dismissed' ? 'muted' : ''}`}>
      <div className="media-cell">
        {item.status === 'ready' && <input className="row-checkbox" type="checkbox" checked={selected} onChange={onToggle} aria-label={t('selectItem')} />}
        <Poster item={item} />
        <div>
          {seerrLink ? (
            <a className="media-link" href={seerrLink} target="_blank" rel="noreferrer"><strong>{item.title}</strong><ExternalLink size={12} /></a>
          ) : <strong>{item.title}</strong>}
          <small>{serverText(item.subtitle, language)}{item.year ? ` · ${item.year}` : ''}</small>
        </div>
      </div>
      <div className="user-cell">
        <span className="avatar">{item.requester.slice(0, 1).toUpperCase()}</span>
        <span>{item.requester}</span>
      </div>
      <div className="request-date-cell">{formatDate(item.requestedAt, language)}</div>
      <div className="progress-cell">
        <div>
          <span>{item.mediaKind === 'movie' ? `${item.progress}%` : `${item.watchedItems}/${item.totalItems}`}</span>
          <small>{serverText(item.reason, language)}</small>
        </div>
        <div className="progress-track"><span style={{ width: `${item.progress}%` }} /></div>
      </div>
      <div className="date-cell">{formatDateTime(item.lastWatchedAt, language)}</div>
      <div className="size-cell">{formatBytes(item.fileSizeBytes, language)}</div>
      <div className="status-cell"><span className={`status-pill ${item.status}`}><i />{statusLabel(item.status, language)}</span></div>
      <div className="row-actions">
        <button className="ignore-button" onClick={() => onDismiss(item)}><EyeOff size={13} /><span>{t('ignore')}</span></button>
        {['ready', 'waiting', 'partial'].includes(item.status) && (
          <button className="danger-icon" aria-label={removeLabel} title={removeLabel} onClick={() => onRemove(item)}><Trash2 size={16} /></button>
        )}
      </div>
    </div>
  );
}

export function Poster({ item }: { item: Suggestion }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`poster-placeholder ${item.mediaKind}`}>
      {item.posterUrl && !failed
        ? <img src={item.posterUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span>{item.mediaKind === 'movie' ? <Film size={20} /> : <Tv size={20} />}</span>}
    </div>
  );
}
