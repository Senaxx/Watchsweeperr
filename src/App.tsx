import { ChevronRight, History, LayoutDashboard, LogOut, Menu, Play, RefreshCw, Settings as SettingsIcon, ShieldCheck, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { Language, Overview, PublicSettings, ServiceConfig, ServiceName, Suggestion, SuggestionStatus } from '../shared';
import { Activity } from './components/Activity';
import { Dashboard } from './components/Dashboard';
import { BulkRemoveDialog, RemoveDialog } from './components/Dialogs';
import { Login } from './components/Login';
import { type AccountUpdate, Settings } from './components/Settings';
import { ThemeMenu } from './components/ThemeMenu';
import { api, serviceNames, services, SIGNED_OUT_EVENT, suggestionGenres } from './format';
import { serverText, translator } from './i18n';

type Page = 'dashboard' | 'activity' | 'settings';
export type Drafts = Record<ServiceName, ServiceConfig>;
export type ServiceTest = { state: 'idle' | 'testing' | 'ok' | 'error'; version?: string; message?: string };
type Notice = { kind: 'success' | 'error'; text: string };
type AuthStatus = { configured: boolean; authenticated: boolean; username?: string; language: Language };

const pageTitleKeys = { dashboard: 'overview', activity: 'activity', settings: 'settings' } as const;

function draftsFrom(settings: PublicSettings): Drafts {
  return Object.fromEntries(serviceNames.map((name) => [name, { url: settings.services[name].url, apiKey: '' }])) as Drafts;
}

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<PublicSettings | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [tests, setTests] = useState<Record<ServiceName, ServiceTest>>({
    seerr: { state: 'idle' }, tautulli: { state: 'idle' }, radarr: { state: 'idle' }, sonarr: { state: 'idle' }
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removing, setRemoving] = useState<Suggestion | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The group whose selection the bulk dialog removes; each group's button only removes its own selection.
  const [bulkStatus, setBulkStatus] = useState<SuggestionStatus | null>(null);
  const [query, setQuery] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const language = settings?.language ?? auth?.language ?? 'nl';
  const t = translator(language);
  const fail = (error: unknown, fallback: Parameters<typeof t>[0]) =>
    setNotice({ kind: 'error', text: error instanceof Error ? serverText(error.message, language) : t(fallback) });

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = 'WatchSweeperr';
  }, [language]);

  const unsaved = Boolean(settings && savedSettings && drafts
    && (JSON.stringify(settings) !== JSON.stringify(savedSettings) || JSON.stringify(drafts) !== JSON.stringify(draftsFrom(savedSettings))));
  // Read by load(), which runs after every action: a refresh must not wipe settings you are still editing.
  const unsavedRef = useRef(false);
  unsavedRef.current = unsaved;

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  async function load(): Promise<boolean> {
    try {
      const [nextOverview, nextSettings] = await Promise.all([api<Overview>('/api/overview'), api<PublicSettings>('/api/settings')]);
      setOverview(nextOverview);
      setSavedSettings(nextSettings);
      if (!unsavedRef.current) {
        setSettings(nextSettings);
        setDrafts(draftsFrom(nextSettings));
      }
      return true;
    } catch (error) {
      fail(error, 'loadError');
      return false;
    }
  }

  async function checkAuth() {
    // The server may be restarting (for example during an update); try again instead of loading forever.
    const retry = () => window.setTimeout(() => void checkAuth(), 3000);
    try {
      const status = await api<AuthStatus>('/api/auth/status');
      setAuth(status);
      if (status.configured && status.authenticated && !(await load())) retry();
    } catch (error) {
      fail(error, 'loadError');
      retry();
    }
  }

  useEffect(() => {
    void checkAuth();
    const signedOut = () => setAuth((current) => current && { ...current, authenticated: false });
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAuth((current) => current && { ...current, authenticated: false, username: undefined });
    setOverview(null);
    setSettings(null);
    setSavedSettings(null);
    unsavedRef.current = false;
  }

  async function updateAccount(input: AccountUpdate): Promise<boolean> {
    setBusy(true);
    try {
      const result = await api<{ username: string }>('/api/auth/account', { method: 'PUT', body: JSON.stringify(input) });
      setAuth((current) => current && { ...current, username: result.username });
      setNotice({ kind: 'success', text: t('accountUpdated') });
      return true;
    } catch (error) {
      fail(error, 'saveFailed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setSelectedIds([]);
    setBulkStatus(null);
  }, [query, genreFilter]);

  const genres = useMemo(
    () => [...new Set((overview?.suggestions ?? []).flatMap((item) => suggestionGenres(item, language)))].sort((a, b) => a.localeCompare(b, language)),
    [overview, language]
  );

  const visibleSuggestions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (overview?.suggestions ?? []).filter((item) => {
      const matchesSearch = !search || `${item.title} ${item.subtitle} ${item.requester}`.toLowerCase().includes(search);
      const matchesGenre = !genreFilter || suggestionGenres(item, language).includes(genreFilter);
      return !['removed', 'dismissed'].includes(item.status) && matchesSearch && matchesGenre;
    });
  }, [overview, query, genreFilter, language]);

  const selected = useMemo(
    () => (overview?.suggestions ?? []).filter((item) => selectedIds.includes(item.id) && item.status === bulkStatus),
    [overview, selectedIds, bulkStatus]
  );

  async function run(action: () => Promise<void>, fallback: Parameters<typeof t>[0]) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      fail(error, fallback);
      // A failed removal may still have removed part of the selection, so always show the current state.
      await load();
    } finally {
      setBusy(false);
    }
  }

  const sync = () => {
    setNotice(null);
    return run(async () => {
      await api('/api/sync', { method: 'POST' });
      await load();
      setNotice({ kind: 'success', text: overview?.demoMode ? t('demoScanComplete') : t('syncComplete') });
    }, 'syncFailed');
  };

  const save = () => {
    if (!settings || !drafts) return;
    setNotice(null);
    return run(async () => {
      const saved = await api<PublicSettings>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          language: settings.language,
          demoMode: settings.demoMode,
          watchThreshold: settings.watchThreshold,
          retentionMonths: settings.retentionMonths,
          retentionDays: settings.retentionDays,
          excludedUsers: settings.excludedUsers,
          ignoredGenres: settings.ignoredGenres,
          automaticRemovalRules: settings.automaticRemovalRules,
          services: drafts
        })
      });
      setSettings(saved);
      setSavedSettings(saved);
      setDrafts(draftsFrom(saved));
      unsavedRef.current = false;
      await load();
      setNotice({ kind: 'success', text: translator(saved.language)('settingsSaved') });
    }, 'saveFailed');
  };

  async function testConnection(name: ServiceName) {
    if (!drafts) return;
    setTests((current) => ({ ...current, [name]: { state: 'testing' } }));
    try {
      const result = await api<{ version: string }>(`/api/services/${name}/test`, { method: 'POST', body: JSON.stringify(drafts[name]) });
      setTests((current) => ({ ...current, [name]: { state: 'ok', version: result.version } }));
    } catch (error) {
      setTests((current) => ({ ...current, [name]: { state: 'error', message: error instanceof Error ? error.message : undefined } }));
    }
  }

  const confirmRemove = () => removing && run(async () => {
    const result = await api<{ detail: string }>(`/api/suggestions/${removing.id}/remove`, { method: 'POST', body: JSON.stringify({ confirmation: true }) });
    setRemoving(null);
    await load();
    setNotice({ kind: 'success', text: serverText(result.detail, language) });
  }, 'removeFailed');

  const confirmBulkRemove = () => selected.length > 0 && run(async () => {
    try {
      const result = await api<{ removed: number }>('/api/suggestions/bulk-remove', {
        method: 'POST',
        body: JSON.stringify({ ids: selected.map((item) => item.id), confirmation: true })
      });
      setNotice({ kind: 'success', text: t('bulkRemovedNotice', { count: result.removed }) });
    } finally {
      setBulkStatus(null);
      setSelectedIds((current) => current.filter((id) => !selected.some((item) => item.id === id)));
    }
    await load();
  }, 'removeFailed');

  const dismiss = (item: Suggestion) => run(async () => {
    await api(`/api/suggestions/${item.id}/dismiss`, { method: 'POST' });
    await load();
    setNotice({ kind: 'success', text: t('ignoredNotice', { title: item.title }) });
  }, 'actionFailed');

  const restore = (item: Suggestion) => {
    setNotice(null);
    return run(async () => {
      await api(`/api/suggestions/${item.id}/restore`, { method: 'POST' });
      await load();
      setNotice({ kind: 'success', text: t('restoredNotice', { title: item.title }) });
    }, 'restoreFailed');
  };

  const readyCount = overview?.suggestions.filter((item) => item.status === 'ready').length ?? 0;
  const partialCount = overview?.suggestions.filter((item) => item.status === 'partial').length ?? 0;
  const go = (next: Page) => {
    setPage(next);
    setMenuOpen(false);
  };

  if (auth && (!auth.configured || !auth.authenticated)) {
    return (
      <Login
        key={auth.configured ? 'login' : 'setup'}
        mode={auth.configured ? 'login' : 'setup'}
        language={language}
        onSignedIn={() => void checkAuth()}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Play size={15} fill="currentColor" /></div>
          <span>WatchSweeperr</span>
          <button className="mobile-close" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <nav>
          <NavItem active={page === 'dashboard'} icon={<LayoutDashboard size={17} />} label={t('overview')} onClick={() => go('dashboard')} badge={readyCount || undefined} />
          <NavItem active={page === 'activity'} icon={<History size={17} />} label={t('activity')} onClick={() => go('activity')} />
          <NavItem active={page === 'settings'} icon={<SettingsIcon size={17} />} label={t('settings')} onClick={() => go('settings')} />
        </nav>
        <div className="sidebar-section-label">SERVICES</div>
        <div className="service-list">
          {serviceNames.map((name) => (
            // Without a URL the anchor has no href, so it stays plain text.
            <a
              className="service-mini"
              key={name}
              href={settings?.services[name].url || undefined}
              target="_blank"
              rel="noreferrer"
              title={settings?.services[name].url ? t('openService', { name: services[name].label }) : undefined}
            >
              <img className="service-mini-logo" src={services[name].logo} alt="" />
              <div>
                <strong>{services[name].label}</strong>
                <small>{t(services[name].roleKey)}</small>
              </div>
              <span className={`connection-dot ${settings?.services[name].configured ? 'online' : ''}`} />
            </a>
          ))}
        </div>
        <div className="sidebar-foot">
          <ShieldCheck size={15} />
          <span>{settings?.automaticRemovalRules.length ? t('automaticRulesActive') : t('manualReviewActive')}</span>
          {auth?.username && (
            <button className="sign-out" onClick={signOut} title={`${t('signOut')} (${auth.username})`} aria-label={t('signOut')}><LogOut size={15} /></button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMenuOpen(true)}><Menu size={19} /></button>
          <div className="crumb">
            <span>WatchSweeperr</span>
            <ChevronRight size={13} />
            <strong>{t(pageTitleKeys[page])}</strong>
          </div>
          <ThemeMenu language={language} />
        </header>

        <div className="content">
          {notice && (
            <div className={`notice ${notice.kind}`}>
              <span>{notice.text}</span>
              <button onClick={() => setNotice(null)}><X size={15} /></button>
            </div>
          )}
          {!overview || !settings || !drafts ? (
            <Loading language={language} />
          ) : page === 'dashboard' ? (
            <Dashboard
              language={language}
              overview={overview}
              readyCount={readyCount}
              partialCount={partialCount}
              suggestions={visibleSuggestions}
              query={query}
              setQuery={setQuery}
              genres={genres}
              genreFilter={genreFilter}
              setGenreFilter={setGenreFilter}
              sync={sync}
              busy={busy}
              onRemove={setRemoving}
              onDismiss={dismiss}
              goSettings={() => setPage('settings')}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              openBulkDialog={setBulkStatus}
              seerrBaseUrl={settings.services.seerr.url}
            />
          ) : page === 'activity' ? (
            <Activity activity={overview.activity} language={language} />
          ) : (
            <Settings
              overview={overview}
              settings={settings}
              setSettings={setSettings}
              drafts={drafts}
              setDrafts={setDrafts}
              tests={tests}
              testConnection={testConnection}
              save={save}
              restoreIgnored={restore}
              discard={() => { if (savedSettings) { setSettings(savedSettings); setDrafts(draftsFrom(savedSettings)); } }}
              busy={busy}
              language={language}
              unsaved={unsaved}
              username={auth?.username ?? ''}
              updateAccount={updateAccount}
            />
          )}
        </div>
      </main>

      {removing && (
        <RemoveDialog suggestion={removing} demoMode={overview?.demoMode ?? true} busy={busy} close={() => setRemoving(null)} confirm={confirmRemove} language={language} />
      )}
      {selected.length > 0 && (
        <BulkRemoveDialog suggestions={selected} demoMode={overview?.demoMode ?? true} busy={busy} close={() => setBulkStatus(null)} confirm={confirmBulkRemove} language={language} />
      )}
    </div>
  );
}

function NavItem({ active, icon, label, onClick, badge }: { active: boolean; icon: ReactNode; label: string; onClick: () => void; badge?: number }) {
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {badge ? <b>{badge}</b> : null}
    </button>
  );
}

function Loading({ language }: { language: Language }) {
  return (
    <div className="loading">
      <RefreshCw className="spin" size={22} />
      <span>{translator(language)('loading')}</span>
    </div>
  );
}
