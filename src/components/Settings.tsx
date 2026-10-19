import { Eye, EyeOff, Film, Languages, Plus, RefreshCw, RotateCcw, Server, Settings as SettingsIcon, ShieldCheck, Tag, Trash2, Tv, Unplug, UserMinus, UserRound, X } from 'lucide-react';
import { type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useMemo, useState } from 'react';
import { localizeGenre } from '../../genres';
import type { AutomaticRemovalRule, Language, Overview, PublicSettings, ServiceName, Suggestion } from '../../shared';
import type { Drafts, ServiceTest } from '../App';
import { serviceNames, services, suggestionGenres } from '../format';
import { serverText, translator } from '../i18n';
import { Poster } from './Dashboard';

export interface AccountUpdate {
  currentPassword: string;
  username: string;
  newPassword: string;
}

interface SettingsProps {
  overview: Overview;
  settings: PublicSettings;
  setSettings: Dispatch<SetStateAction<PublicSettings | null>>;
  drafts: Drafts;
  setDrafts: Dispatch<SetStateAction<Drafts | null>>;
  tests: Record<ServiceName, ServiceTest>;
  testConnection: (name: ServiceName) => void;
  save: () => void;
  restoreIgnored: (item: Suggestion) => void;
  busy: boolean;
  language: Language;
  unsaved: boolean;
  username: string;
  updateAccount: (input: AccountUpdate) => Promise<boolean>;
}

const clamp = (value: string, max: number) => Math.min(max, Math.max(0, Math.trunc(Number(value) || 0)));

export function Settings({ overview, settings, setSettings, drafts, setDrafts, tests, testConnection, save, restoreIgnored, busy, language, unsaved, username, updateAccount }: SettingsProps) {
  const t = translator(language);
  const [visibleKeys, setVisibleKeys] = useState<Record<ServiceName, boolean>>({ seerr: false, tautulli: false, radarr: false, sonarr: false });
  const [userInput, setUserInput] = useState('');
  const [genreInput, setGenreInput] = useState('');
  const [ruleInput, setRuleInput] = useState('');
  const update = (change: Partial<PublicSettings>) => setSettings({ ...settings, ...change });
  const sameName = (a: string, b: string) => a.toLocaleLowerCase(language) === b.toLocaleLowerCase(language);

  const knownRequesters = useMemo(
    () => [...new Set(overview.suggestions.map((item) => item.requester))]
      .filter((name) => !settings.excludedUsers.some((excluded) => sameName(excluded, name)))
      .sort((a, b) => a.localeCompare(b, language)),
    [overview.suggestions, settings.excludedUsers, language]
  );
  const knownGenres = useMemo(
    () => [...new Set(overview.suggestions.flatMap((item) => suggestionGenres(item, language)))]
      .filter((genre) => !settings.ignoredGenres.some((ignored) => sameName(ignored, genre)))
      .sort((a, b) => a.localeCompare(b, language)),
    [overview.suggestions, settings.ignoredGenres, language]
  );

  function addExcludedUser() {
    const name = userInput.trim();
    if (!name || settings.excludedUsers.some((user) => sameName(user, name))) return;
    update({ excludedUsers: [...settings.excludedUsers, name] });
    setUserInput('');
  }

  function addIgnoredGenre() {
    const genre = genreInput.trim();
    if (!genre || settings.ignoredGenres.some((ignored) => sameName(ignored, genre))) return;
    update({ ignoredGenres: [...settings.ignoredGenres, genre] });
    setGenreInput('');
  }

  function addRule() {
    const requester = ruleInput.trim();
    if (!requester
      || settings.automaticRemovalRules.some((rule) => sameName(rule.requester, requester))
      || settings.excludedUsers.some((user) => sameName(user, requester))) return;
    update({ automaticRemovalRules: [...settings.automaticRemovalRules, { requester, movies: true, series: false, delayDays: 0 }] });
    setRuleInput('');
  }

  function updateRule(index: number, change: Partial<AutomaticRemovalRule>) {
    update({
      automaticRemovalRules: settings.automaticRemovalRules.map((rule, current) => {
        if (current !== index) return rule;
        const next = { ...rule, ...change };
        // A rule must keep at least movies or series switched on.
        return next.movies || next.series ? next : rule;
      })
    });
  }

  return (
    <>
      <section className="simple-head settings-head reveal">
        <div>
          <div className="eyebrow"><SettingsIcon size={13} /> {t('connectionsAndRules')}</div>
          <h1>{t('settings')}</h1>
          <p>{t('settingsDescription')}</p>
        </div>
        <button className="primary-button" onClick={save} disabled={busy}>{t(busy ? 'saving' : 'saveChanges')}</button>
      </section>

      <section className="settings-layout reveal delay-1">
        <div className="settings-main">
          <div className="settings-title">
            <h2>{t('general')}</h2>
            <p>{t('generalDescription')}</p>
          </div>
          <div className="service-cards">
            <article className="service-card">
              <div className="service-card-head">
                <div className="service-logo"><Languages size={17} /></div>
                <div>
                  <h3>{t('language')}</h3>
                  <p>{t('languageDescription')}</p>
                </div>
              </div>
              <label className="auth-field">
                <span>{t('language')}</span>
                <select value={settings.language} onChange={(event) => update({ language: event.target.value as Language })}>
                  <option value="nl">{t('dutch')}</option>
                  <option value="en">{t('english')}</option>
                </select>
              </label>
            </article>
            <AccountForm username={username} updateAccount={updateAccount} busy={busy} language={language} />
          </div>

          <div className="settings-title">
            <h2>{t('services')}</h2>
            <p>{t('baseUrlHelp')}</p>
          </div>
          <div className="service-cards">
            {serviceNames.map((name) => {
              const service = services[name];
              const saved = settings.services[name];
              const test = tests[name];
              const setDraft = (change: Partial<Drafts[ServiceName]>) => setDrafts({ ...drafts, [name]: { ...drafts[name], ...change } });
              return (
                <article className="service-card" key={name}>
                  <div className="service-card-head">
                    <div className="service-logo"><img src={service.logo} alt="" /></div>
                    <div>
                      <h3>{service.label}</h3>
                      <p>{t(service.roleKey)}</p>
                    </div>
                    <span className={`config-state ${saved.configured ? 'configured' : ''}`}>{saved.configured ? t('configured') : t('apiKeyRequired')}</span>
                  </div>
                  <div className="service-fields">
                    <label>
                      <span>{t('baseUrl')}</span>
                      <input value={drafts[name].url} onChange={(event) => setDraft({ url: event.target.value })} />
                    </label>
                    <label>
                      <span>API-key {saved.configured && <small>{saved.keyPreview}</small>}</span>
                      <div className="secret-input">
                        <input
                          type={visibleKeys[name] ? 'text' : 'password'}
                          value={drafts[name].apiKey}
                          placeholder={saved.configured ? t('keepCurrentKey') : t('pasteApiKey')}
                          onChange={(event) => setDraft({ apiKey: event.target.value })}
                        />
                        <button onClick={() => setVisibleKeys({ ...visibleKeys, [name]: !visibleKeys[name] })}>
                          {visibleKeys[name] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </label>
                  </div>
                  <div className="service-card-foot">
                    <span className={`test-result ${test.state}`}>
                      {test.state === 'testing' ? t('testingConnection')
                        : test.state === 'ok' && test.version ? t('connected', { version: test.version })
                          : test.message ? serverText(test.message, language) : t('notTested')}
                    </span>
                    <button className="secondary-button" onClick={() => testConnection(name)} disabled={test.state === 'testing'}>
                      {test.state === 'testing' ? <RefreshCw className="spin" size={14} /> : <Unplug size={14} />}
                      {t('testConnection')}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <section className="management-panel">
            <header className="management-panel-head">
              <div>
                <div className="eyebrow">{t('managementAndExceptions')}</div>
                <h2>{t('manageRequests')}</h2>
                <p>{t('manageRequestsDescription')}</p>
              </div>
              <div className="management-totals" aria-label={t('managementSummary')}>
                <span><b>{settings.excludedUsers.length}</b> {t('excludedCount')}</span>
                <span><b>{settings.ignoredGenres.length}</b> {t('genreCount')}</span>
                <span><b>{settings.automaticRemovalRules.length}</b> {t('automaticCount')}</span>
                <span><b>{overview.ignoredSuggestions.length}</b> {t('ignoredCount')}</span>
              </div>
            </header>

            <ManagementSection icon={<UserMinus size={17} />} title={t('excludedRequesters')} count={settings.excludedUsers.length} description={t('excludedRequestersDescription')}>
              <AddRow value={userInput} setValue={setUserInput} onAdd={addExcludedUser} placeholder={t('chooseOrTypeUser')} label={t('add')} list="known-requesters" options={knownRequesters} />
              <div className="user-chip-list">
                {settings.excludedUsers.length ? settings.excludedUsers.map((user) => (
                  <span className="user-chip" key={user}>
                    {user}
                    <button aria-label={t('stopExcluding', { name: user })} onClick={() => update({ excludedUsers: settings.excludedUsers.filter((value) => value !== user) })}><X size={13} /></button>
                  </span>
                )) : <span className="management-empty">{t('noExcludedUsers')}</span>}
              </div>
              <small className="management-note">{t('saveToApply')}</small>
            </ManagementSection>

            <ManagementSection icon={<Tag size={17} />} title={t('ignoredGenres')} count={settings.ignoredGenres.length} description={t('ignoredGenresDescription')}>
              <AddRow value={genreInput} setValue={setGenreInput} onAdd={addIgnoredGenre} placeholder={t('chooseOrTypeGenre')} label={t('add')} list="known-genres" options={knownGenres} />
              <div className="user-chip-list">
                {settings.ignoredGenres.length ? settings.ignoredGenres.map((genre) => {
                  const label = localizeGenre(genre, language);
                  return (
                    <span className="user-chip" key={genre}>
                      {label}
                      <button aria-label={t('stopIgnoringGenre', { genre: label })} onClick={() => update({ ignoredGenres: settings.ignoredGenres.filter((value) => value !== genre) })}><X size={13} /></button>
                    </span>
                  );
                }) : <span className="management-empty">{t('noIgnoredGenres')}</span>}
              </div>
              <small className="management-note">{t('ignoredGenresWarning')}</small>
            </ManagementSection>

            <ManagementSection icon={<Trash2 size={17} />} danger title={t('automaticRemoval')} count={settings.automaticRemovalRules.length} description={t('automaticRemovalDescription')}>
              {/* Reuses the requester list rendered by the excluded-requesters row above. */}
              <AddRow value={ruleInput} setValue={setRuleInput} onAdd={addRule} placeholder={t('chooseUser')} label={t('addRule')} list="known-requesters" />
              <div className="automation-rule-list">
                {settings.automaticRemovalRules.length ? settings.automaticRemovalRules.map((rule, index) => (
                  <div className="automation-rule" key={rule.requester}>
                    <strong>{rule.requester}</strong>
                    <div className="automation-media-options">
                      <button aria-pressed={rule.movies} className={rule.movies ? 'active' : ''} onClick={() => updateRule(index, { movies: !rule.movies })}><Film size={14} />{t('movies')}</button>
                      <button aria-pressed={rule.series} className={rule.series ? 'active' : ''} onClick={() => updateRule(index, { series: !rule.series })}><Tv size={14} />{t('series')}</button>
                    </div>
                    <label className="delay-control">
                      <span>{t('delay')}</span>
                      <input type="number" min="0" max="365" value={rule.delayDays} onChange={(event) => updateRule(index, { delayDays: clamp(event.target.value, 365) })} />
                      <span>{t('days')}</span>
                    </label>
                    <button
                      className="remove-rule"
                      aria-label={t('disableAutomatic', { name: rule.requester })}
                      onClick={() => update({ automaticRemovalRules: settings.automaticRemovalRules.filter((_, current) => current !== index) })}
                    ><X size={14} /></button>
                  </div>
                )) : <span className="management-empty">{t('noAutomaticRules')}</span>}
              </div>
              <div className="automation-warning"><ShieldCheck size={15} /><span>{t('automationWarning')}</span></div>
              <small className="management-note">{t('saveToActivate')}</small>
            </ManagementSection>

            <ManagementSection icon={<EyeOff size={17} />} title={t('ignoredTitles')} count={overview.ignoredSuggestions.length} description={t('ignoredTitlesDescription')}>
              <div className="ignored-list">
                {overview.ignoredSuggestions.length ? overview.ignoredSuggestions.map((item) => (
                  <div className="ignored-item" key={item.id}>
                    <Poster item={item} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{serverText(item.subtitle, language)} · {item.requester}</span>
                    </div>
                    <button className="secondary-button restore-button" onClick={() => restoreIgnored(item)} disabled={busy}><RotateCcw size={13} />{t('restore')}</button>
                  </div>
                )) : <span className="management-empty">{t('noIgnoredTitles')}</span>}
              </div>
            </ManagementSection>
          </section>
        </div>

        <aside className="rules-card">
          <div className="rules-icon"><ShieldCheck size={22} /></div>
          <h2>{t('safetyRules')}</h2>
          <p>{settings.automaticRemovalRules.length ? t('manualExceptRules') : t('proposalsOnly')}</p>
          <div className="rule">
            <div>
              <strong>{t('demoMode')}</strong>
              <span>{t('noExternalChanges')}</span>
            </div>
            <button className={`switch ${settings.demoMode ? 'on' : ''}`} aria-pressed={settings.demoMode} aria-label={t('demoMode')} onClick={() => update({ demoMode: !settings.demoMode })}><span /></button>
          </div>
          <div className="rule vertical">
            <div>
              <strong>{t('watchedFrom')}</strong>
              <span>{t('percentageDescription')}</span>
            </div>
            <div className="range-row">
              <input type="range" min="50" max="100" step="5" value={settings.watchThreshold} onChange={(event) => update({ watchThreshold: Number(event.target.value) })} />
              <b>{settings.watchThreshold}%</b>
            </div>
          </div>
          <div className="rule retention-rule">
            <div>
              <strong>{t('cleanAfter')}</strong>
              <span>{t('retentionDescription')}</span>
            </div>
            <div className="cutoff-control">
              <label>
                <span>{t('days')}</span>
                {/* Older settings may still hold whole months; shown here as 30 days each and saved as days only. */}
                <input
                  type="number"
                  min="0"
                  max="1095"
                  step="1"
                  value={settings.retentionMonths * 30 + settings.retentionDays}
                  onChange={(event) => update({ retentionMonths: 0, retentionDays: clamp(event.target.value, 1095) })}
                />
              </label>
            </div>
          </div>
          <div className="safety-note">
            <ShieldCheck size={15} />
            <span>{t('movieSafety')}<br />{t('seriesSafety')}</span>
          </div>
          <div className="plaintext-note">
            <Server size={14} />
            <span>{t('storageWarning')}</span>
          </div>
        </aside>
      </section>

      {unsaved && (
        <div className="save-bar" role="status">
          <span>{t('unsavedChanges')}</span>
          <button className="primary-button" onClick={save} disabled={busy}>{t(busy ? 'saving' : 'saveChanges')}</button>
        </div>
      )}
    </>
  );
}

function ManagementSection({ icon, danger = false, title, count, description, children }: {
  icon: ReactNode;
  danger?: boolean;
  title: string;
  count: number;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="management-section">
      <div className="management-head">
        <div className={danger ? 'management-icon danger' : 'management-icon'}>{icon}</div>
        <div>
          <h2>{title} <b>{count}</b></h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="management-section-content">{children}</div>
    </section>
  );
}

function AddRow({ value, setValue, onAdd, placeholder, label, list, options }: {
  value: string;
  setValue: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  label: string;
  list: string;
  options?: string[];
}) {
  return (
    <div className="user-add-row">
      <input list={list} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAdd(); }} placeholder={placeholder} />
      {options && <datalist id={list}>{options.map((option) => <option key={option} value={option} />)}</datalist>}
      <button className="secondary-button" onClick={onAdd} disabled={!value.trim()}><Plus size={14} />{label}</button>
    </div>
  );
}

function AccountForm({ username, updateAccount, busy, language }: { username: string; updateAccount: SettingsProps['updateAccount']; busy: boolean; language: Language }) {
  const t = translator(language);
  const [form, setForm] = useState<AccountUpdate>({ currentPassword: '', username, newPassword: '' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await updateAccount(form)) setForm({ currentPassword: '', username: form.username, newPassword: '' });
  }

  return (
    <form className="service-card account-form" onSubmit={submit}>
      <div className="service-card-head">
        <div className="service-logo"><UserRound size={17} /></div>
        <div>
          <h3>{t('account')}</h3>
          <p>{t('accountDescription')}</p>
        </div>
      </div>
      <label className="auth-field">
        <span>{t('username')}</span>
        <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required />
      </label>
      <label className="auth-field">
        <span>{t('newPassword')}</span>
        <input type="password" value={form.newPassword} placeholder={t('keepPassword')} minLength={8} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} autoComplete="new-password" />
      </label>
      <label className="auth-field">
        <span>{t('currentPassword')}</span>
        <input type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} autoComplete="current-password" required />
      </label>
      <button className="secondary-button" type="submit" disabled={busy}>{t('updateAccount')}</button>
    </form>
  );
}
