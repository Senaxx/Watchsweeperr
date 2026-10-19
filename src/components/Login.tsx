import { Play } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { Language } from '../../shared';
import { api } from '../format';
import { serverText, translator } from '../i18n';

export function Login({ mode, language, onSignedIn }: { mode: 'setup' | 'login'; language: Language; onSignedIn: (username: string) => void }) {
  const t = translator(language);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ username: string }>(setup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      onSignedIn(result.username);
    } catch (failure) {
      setError(failure instanceof Error ? serverText(failure.message, language) : t('actionFailed'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark"><Play size={15} fill="currentColor" /></div>
          <span>WatchSweeperr</span>
        </div>
        <div>
          <h1>{t(setup ? 'setupTitle' : 'signInTitle')}</h1>
          <p>{t(setup ? 'setupDescription' : 'signInDescription')}</p>
        </div>
        {error && <div className="notice error" role="alert"><span>{error}</span></div>}
        <label className="auth-field">
          <span>{t('username')}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="auth-field">
          <span>{t('password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={setup ? 'new-password' : 'current-password'}
            minLength={setup ? 8 : undefined}
            required
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? t('working') : t(setup ? 'createAccount' : 'signIn')}</button>
      </form>
    </div>
  );
}
