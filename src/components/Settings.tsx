import { Film, Pencil, Plus, RefreshCw, RotateCcw, ShieldCheck, Tv, Unplug, X } from 'lucide-react';
import { type Dispatch, type FormEvent, type ReactNode, type SetStateAction, useMemo, useState } from 'react';
import { localizeGenre } from '../../genres';
import type { AutomaticRemovalRule, Language, Overview, PublicSettings, ServiceName, Suggestion } from '../../shared';
import type { Drafts, ServiceTest } from '../App';
import { serviceNames, services, suggestionGenres } from '../format';
import { serverText, translator, type Translate } from '../i18n';
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
  discard: () => void;
  restoreIgnored: (item: Suggestion) => void;
  busy: boolean;
  language: Language;
  unsaved: boolean;
  username: string;
  updateAccount: (input: AccountUpdate) => Promise<boolean>;
}

const clamp = (value: string, max: number) => Math.min(max, Math.max(0, Math.trunc(Number(value) || 0)));

export function Settings({ overview, settings, setSettings, drafts, setDrafts, tests, testConnection, save, discard, restoreIgnored, busy, language, unsaved, username, updateAccount }: SettingsProps) {
  const t = translator(language);
  const [editing, setEditing] = useState<ServiceName | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [editingAccount, setEditingAccount] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [genreInput, setGenreInput] = useState('');
  const [ruleInput, setRuleInput] = useState('');
  const update = (change: Partial<PublicSettings>) => setSettings({ ...settings, ...change });
  const sameName = (a: string, b: string) => a.toLocaleLowerCase(language) === b.toLocaleLowerCase(language);
  const configured = serviceNames.filter((name) => settings.services[name].configured).length;
  const working = serviceNames.filter((name) => tests[name].state === 'ok').length;

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

  function cancelEdit(name: ServiceName) {
    setDrafts({ ...drafts, [name]: { url: settings.services[name].url, apiKey: '' } });
    setEditing(null);
  }

  return (
    <div className="settings-stack reveal">
      <section className="simple-head">
        <h1>{t('settings')}</h1>
        <p>{t('settingsDescription')}</p>
      </section>

      <Section title={t('general')}>
        <Row label={t('language')} description={t('languageDescription')}>
          <select className="field" aria-label={t('language')} value={settings.language} onChange={(event) => update({ language: event.target.value as Language })}>
            <option value="nl">{t('dutch')}</option>
            <option value="en">{t('english')}</option>
          </select>
        </Row>
        <Row label={t('demoMode')} description={t('noExternalChanges')}>
          <button className={`switch ${settings.demoMode ? 'on' : ''}`} aria-pressed={settings.demoMode} aria-label={t('demoMode')} onClick={() => update({ demoMode: !settings.demoMode })}><span /></button>
        </Row>
      </Section>

      <Section
        title={t('services')}
        summary={t('servicesSummary', { configured, working })}
        description={t('baseUrlHelp')}
        action={<button className="secondary-button" onClick={() => serviceNames.forEach(testConnection)}><RefreshCw size={14} />{t('testAll')}</button>}
      >
        <div className="table-scroll">
          <table className="services-table">
            <thead>
              <tr>
                <th scope="col">{t('service')}</th>
                <th scope="col">{t('baseUrl')}</th>
                <th scope="col">API-key</th>
                <th scope="col">{t('connection')}</th>
                <th scope="col">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {serviceNames.map((name) => {
                const saved = settings.services[name];
                const label = <ServiceLabel name={name} t={t} />;
                if (editing === name) {
                  const setDraft = (change: Partial<Drafts[ServiceName]>) => setDrafts({ ...drafts, [name]: { ...drafts[name], ...change } });
                  return (
                    <tr key={name} className="edit-row">
                      <td>{label}</td>
                      <td colSpan={4}>
                        <div className="edit-form">
                          <label>{t('baseUrl')}
                            <input className="field" value={drafts[name].url} onChange={(event) => setDraft({ url: event.target.value })} autoFocus />
                          </label>
                          <label>API-key
                            <input className="field" type="password" value={drafts[name].apiKey} placeholder={saved.configured ? `${t('keepCurrentKey')} ${saved.keyPreview}` : t('pasteApiKey')} onChange={(event) => setDraft({ apiKey: event.target.value })} />
                          </label>
                          <button className="secondary-button" onClick={() => testConnection(name)}>{t('testConnection')}</button>
                          <button className="primary-button" onClick={() => { save(); setEditing(null); }} disabled={busy}>{t('saveChanges')}</button>
                          <button className="text-button" onClick={() => cancelEdit(name)}>{t('cancel')}</button>
                        </div>
                        <ConnectionBadge test={tests[name]} configured={saved.configured} t={t} language={language} />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={name}>
                    <td>{label}</td>
                    <td className="mono">{saved.url || '—'}</td>
                    <td className="mono muted">{saved.keyPreview || '—'}</td>
                    <td><ConnectionBadge test={tests[name]} configured={saved.configured} t={t} language={language} /></td>
                    <td className="row-buttons">
                      <button className="icon-action" aria-label={`${t('testConnection')}: ${services[name].label}`} title={t('testConnection')} onClick={() => testConnection(name)} disabled={tests[name].state === 'testing'}>
                        {tests[name].state === 'testing' ? <RefreshCw className="spin" size={14} /> : <Unplug size={14} />}
                      </button>
                      <button className="icon-action" aria-label={`${t('edit')}: ${services[name].label}`} title={t('edit')} onClick={() => setEditing(name)}><Pencil size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="section-footnote">{t('storageWarning')}</p>
      </Section>

      <Section title={t('rules')}>
        <Row label={t('watchedFrom')} description={t('percentageDescription')}>
          <input className="range" type="range" min="50" max="100" step="5" aria-label={t('watchedFrom')} value={settings.watchThreshold} onChange={(event) => update({ watchThreshold: Number(event.target.value) })} />
          <b className="range-value">{settings.watchThreshold}%</b>
        </Row>
        <Row label={t('cleanAfter')} description={t('retentionDescription')}>
          {/* Older settings may still hold whole months; shown here as 30 days each and saved as days only. */}
          <input
            className="field number"
            type="number"
            min="0"
            max="1095"
            step="1"
            aria-label={t('days')}
            value={settings.retentionMonths * 30 + settings.retentionDays}
            onChange={(event) => update({ retentionMonths: 0, retentionDays: clamp(event.target.value, 1095) })}
          />
          <span className="muted">{t('days')}</span>
        </Row>
        <Row label={t('excludedRequesters')} description={t('excludedRequestersDescription')}>
          {settings.excludedUsers.map((user) => (
            <span className="user-chip" key={user}>
              {user}
              <button aria-label={t('stopExcluding', { name: user })} onClick={() => update({ excludedUsers: settings.excludedUsers.filter((value) => value !== user) })}><X size={13} /></button>
            </span>
          ))}
          <AddRow value={userInput} setValue={setUserInput} onAdd={addExcludedUser} placeholder={t('chooseOrTypeUser')} label={t('add')} list="known-requesters" options={knownRequesters} />
        </Row>
        <Row label={t('ignoredGenres')} description={t('ignoredGenresDescription')}>
          {settings.ignoredGenres.map((genre) => {
            const label = localizeGenre(genre, language);
            return (
              <span className="user-chip" key={genre}>
                {label}
                <button aria-label={t('stopIgnoringGenre', { genre: label })} onClick={() => update({ ignoredGenres: settings.ignoredGenres.filter((value) => value !== genre) })}><X size={13} /></button>
              </span>
            );
          })}
          <AddRow value={genreInput} setValue={setGenreInput} onAdd={addIgnoredGenre} placeholder={t('chooseOrTypeGenre')} label={t('add')} list="known-genres" options={knownGenres} />
        </Row>
        <Row label={t('ignoredTitles')} description={t('ignoredTitlesDescription')}>
          {overview.ignoredSuggestions.length
            ? <button className="secondary-button" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>{showIgnored ? t('hideTitles') : t('showTitles', { count: overview.ignoredSuggestions.length })}</button>
            : <span className="muted">{t('noIgnoredTitles')}</span>}
        </Row>
        {showIgnored && (
          <div className="ignored-list section-inset">
            {overview.ignoredSuggestions.map((item) => (
              <div className="ignored-item" key={item.id}>
                <Poster item={item} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{serverText(item.subtitle, language)} · {item.requester}</span>
                </div>
                <button className="secondary-button restore-button" onClick={() => restoreIgnored(item)} disabled={busy}><RotateCcw size={13} />{t('restore')}</button>
              </div>
            ))}
          </div>
        )}
        <div className="section-note"><ShieldCheck size={14} /><span>{t('movieSafety')} {t('seriesSafety')}</span></div>
      </Section>

      <Section
        title={t('automaticRemoval')}
        description={t('automaticRemovalDescription')}
        action={<AddRow value={ruleInput} setValue={setRuleInput} onAdd={addRule} placeholder={t('chooseUser')} label={t('addRule')} list="known-requesters" />}
      >
        <div className="automation-rule-list section-inset">
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
          )) : <span className="muted">{t('noAutomaticRules')}</span>}
        </div>
        <div className="section-note danger"><ShieldCheck size={14} /><span>{t('automationWarning')}</span></div>
      </Section>

      <Section title={t('account')}>
        <Row label={t('signedInAs', { name: username })} description={t('accountDescription')}>
          <button className="secondary-button" aria-expanded={editingAccount} onClick={() => setEditingAccount(!editingAccount)}>{t(editingAccount ? 'cancel' : 'editAccount')}</button>
        </Row>
        {editingAccount && <AccountForm username={username} updateAccount={updateAccount} busy={busy} language={language} onDone={() => setEditingAccount(false)} />}
      </Section>

      {unsaved && (
        <div className="save-bar" role="status">
          <span>{t('unsavedChanges')}</span>
          <div>
            <button className="text-button" onClick={discard} disabled={busy}>{t('discard')}</button>
            <button className="primary-button" onClick={save} disabled={busy}>{t(busy ? 'saving' : 'saveChanges')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, summary, description, action, children }: { title: string; summary?: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <header className="section-head">
        <div>
          <h2>{title}{summary && <span>{summary}</span>}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Row({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function ServiceLabel({ name, t }: { name: ServiceName; t: Translate }) {
  return (
    <div className="service-name">
      <span className="service-icon"><img src={services[name].logo} alt="" /></span>
      <div>
        <strong>{services[name].label}</strong>
        <small>{t(services[name].roleKey)}</small>
      </div>
    </div>
  );
}

function ConnectionBadge({ test, configured, t, language }: { test: ServiceTest; configured: boolean; t: Translate; language: Language }) {
  if (test.state === 'testing') return <span className="badge">{t('testingConnection')}</span>;
  if (test.state === 'ok') return <span className="badge ok">{t('connected', { version: test.version ?? '' })}</span>;
  if (test.state === 'error') return <span className="badge error" title={serverText(test.message, language)}>{t('connectionFailed')}</span>;
  return configured ? <span className="badge">{t('notTested')}</span> : <span className="badge warn">{t('apiKeyRequired')}</span>;
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
    <div className="add-row">
      <input className="field" list={list} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAdd(); }} placeholder={placeholder} aria-label={placeholder} />
      {options && <datalist id={list}>{options.map((option) => <option key={option} value={option} />)}</datalist>}
      <button className="secondary-button" onClick={onAdd} disabled={!value.trim()}><Plus size={14} />{label}</button>
    </div>
  );
}

function AccountForm({ username, updateAccount, busy, language, onDone }: { username: string; updateAccount: SettingsProps['updateAccount']; busy: boolean; language: Language; onDone: () => void }) {
  const t = translator(language);
  const [form, setForm] = useState<AccountUpdate>({ currentPassword: '', username, newPassword: '' });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await updateAccount(form)) onDone();
  }

  return (
    <form className="edit-form section-inset" onSubmit={submit}>
      <label>{t('username')}
        <input className="field" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required />
      </label>
      <label>{t('newPassword')}
        <input className="field" type="password" value={form.newPassword} placeholder={t('keepPassword')} minLength={8} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} autoComplete="new-password" />
      </label>
      <label>{t('currentPassword')}
        <input className="field" type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} autoComplete="current-password" required />
      </label>
      <button className="primary-button" type="submit" disabled={busy}>{t('updateAccount')}</button>
    </form>
  );
}
