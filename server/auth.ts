import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { z } from 'zod';
import { dataDirectory, getSettings, writeJsonFile } from './settingsStore.js';

interface Account {
  username: string;
  passwordHash: string;
  salt: string;
  // Signs session cookies; replaced on every account change so old sessions stop working.
  sessionSecret: string;
}

const accountPath = () => path.join(dataDirectory, 'auth.json');
const COOKIE = 'watchsweeperr_session';
const SESSION_DAYS = 30;
const hash = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;
const credentialsSchema = z.object({
  username: z.string().trim().min(1, 'Gebruikersnaam is verplicht.').max(80),
  password: z.string().min(8, 'Wachtwoord moet minstens 8 tekens hebben.').max(200)
});

export async function getAccount(): Promise<Account | undefined> {
  try {
    return JSON.parse(await readFile(accountPath(), 'utf8')) as Account;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function saveAccount(username: string, password: string): Promise<Account> {
  const salt = randomBytes(16).toString('hex');
  const account = {
    username,
    passwordHash: (await hash(password, salt, 64)).toString('hex'),
    salt,
    sessionSecret: randomBytes(32).toString('hex')
  };
  await writeJsonFile(accountPath(), account);
  return account;
}

async function passwordMatches(account: Account, password: string): Promise<boolean> {
  return timingSafeEqual(await hash(password, account.salt, 64), Buffer.from(account.passwordHash, 'hex'));
}

function sign(account: Account, value: string): string {
  return createHmac('sha256', account.sessionSecret).update(value).digest('base64url');
}

function sessionCookie(account: Account): string {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const value = `${expires}.${sign(account, String(expires))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

function hasValidSession(account: Account, cookieHeader = ''): boolean {
  const value = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [expires, signature] = value?.split('.') ?? [];
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(account, expires));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

const sameUser = (a: string, b: string) => a.toLocaleLowerCase('nl-NL') === b.toLocaleLowerCase('nl-NL');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PUBLIC_API = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/logout']);

let passwordQueue: Promise<unknown> = Promise.resolve();

// Checks passwords one at a time, so the delay after a wrong one also limits guesses sent in parallel.
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = passwordQueue.then(task);
  passwordQueue = run.catch(() => undefined);
  return run;
}

async function checkPassword(account: Account | undefined, password: string, username = account?.username ?? ''): Promise<boolean> {
  return oneAtATime(async () => {
    if (account && sameUser(account.username, username.trim()) && await passwordMatches(account, password)) return true;
    await wait(1000);
    return false;
  });
}

// Until an account exists the API stays open, so the first visit can create one.
export const requireSession: express.RequestHandler = async (request, response, next) => {
  try {
    // Express matches routes regardless of case, so /API/... must be checked too.
    const path = request.path.toLowerCase();
    if (!path.startsWith('/api/') || PUBLIC_API.has(path)) return next();
    const account = await getAccount();
    if (!account || hasValidSession(account, request.headers.cookie)) return next();
    response.status(401).json({ error: 'Inloggen vereist.' });
  } catch (error) { next(error); }
};

export function authRoutes(): express.Router {
  const router = express.Router();

  router.get('/api/auth/status', async (request, response, next) => {
    try {
      const [account, settings] = await Promise.all([getAccount(), getSettings()]);
      const authenticated = Boolean(account && hasValidSession(account, request.headers.cookie));
      response.json({ configured: Boolean(account), authenticated, username: authenticated ? account?.username : undefined, language: settings.language });
    } catch (error) { next(error); }
  });

  router.post('/api/auth/setup', async (request, response, next) => {
    try {
      const { username, password } = credentialsSchema.parse(request.body);
      if (await getAccount()) return response.status(409).json({ error: 'Er bestaat al een account.' });
      const account = await saveAccount(username, password);
      response.set('Set-Cookie', sessionCookie(account)).json({ username });
    } catch (error) { next(error); }
  });

  router.post('/api/auth/login', async (request, response, next) => {
    try {
      const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(request.body);
      const account = await getAccount();
      const valid = await checkPassword(account, password, username);
      if (!account || !valid) return response.status(401).json({ error: 'Onjuiste gebruikersnaam of wachtwoord.' });
      response.set('Set-Cookie', sessionCookie(account)).json({ username: account.username });
    } catch (error) { next(error); }
  });

  router.post('/api/auth/logout', (_request, response) => {
    response.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`).json({ ok: true });
  });

  router.put('/api/auth/account', async (request, response, next) => {
    try {
      const input = z.object({ currentPassword: z.string(), username: z.string(), newPassword: z.string() }).parse(request.body);
      const account = await getAccount();
      if (!account) return response.status(409).json({ error: 'Er is nog geen account.' });
      if (!(await checkPassword(account, input.currentPassword))) {
        return response.status(403).json({ error: 'Huidig wachtwoord klopt niet.' });
      }
      const { username, password } = credentialsSchema.parse({ username: input.username, password: input.newPassword || input.currentPassword });
      const updated = await saveAccount(username, password);
      response.set('Set-Cookie', sessionCookie(updated)).json({ username });
    } catch (error) { next(error); }
  });

  return router;
}
