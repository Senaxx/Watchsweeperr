# WatchSweeperr

WatchSweeperr cleans up your media server after people have watched what they asked for.

It reads the requests in **Seerr**, checks the watch history in **Tautulli** to see whether the person who made each request has watched it, and then offers to remove the media through **Radarr** (movies) and **Sonarr** (series), together with the Seerr request. Nothing is deleted without your confirmation, unless you switch on automatic removal for a specific user.

The interface is available in Dutch and English.

> [!WARNING]
> **AI disclaimer.** Large parts of this project, including code, tests and documentation, were written with the help of AI tools. The code is reviewed and covered by tests, but it may still contain mistakes. WatchSweeperr permanently deletes media files, so start in demo mode, check what it suggests before you remove anything, and keep backups of media you care about. Use it at your own risk.

## How it works

Every hour (or when you click **Check now**) WatchSweeperr:

1. Reads all requests from Seerr.
2. Keeps only movies and seasons that actually have files in Radarr or Sonarr and have been released.
3. Looks up the requester's watch history in Tautulli, matching by TMDB/TVDB ID first and by exact title and year as a fallback.
4. Sorts every request into one of three groups:
   - **Not watched**: no completed play by the requester.
   - **Ready for review**: fully watched by the requester (movies above the watch threshold, series when every episode of the season is watched).
   - **Being watched**: partly watched.

Fully watched requests appear right away. Requests that are not fully watched only appear once they have been available longer than the retention period you set (for example 1 month and 30 days).

When you remove an item:

- **Movie**: Radarr deletes the movie, its folder and files, then the Seerr request is deleted.
- **Season**: Sonarr deletes the season's files and unmonitors it. When it is the last downloaded season, the whole series and folder are removed. Then the Seerr request is deleted.

## Features

- Overview with open requests, items ready for review, partial watches and server statistics (movies, episodes, free disk space).
- Search by title or user, filter by genre, sort each group.
- Bulk removal of fully watched items, with a review dialog first.
- **Ignore** an item to hide it permanently; restore it later from Settings.
- **Excluded requesters**: requests from these users never appear.
- **Ignored genres**: media in these genres is skipped by scans and automatic removal.
- **Automatic removal** per user, for movies and/or series, with an optional delay in days. Only strong ID matches and plays after the request count.
- Demo mode that never touches your services or files.
- Activity log of scans, removals and changes (newest 200 entries).
- Sign-in with a username and password.

## Running with Docker

```bash
docker run -d \
  --name watchsweeperr \
  -p 4173:4173 \
  -v /path/to/appdata/watchsweeperr:/app/data \
  -e TZ=Europe/Amsterdam \
  senaxx/watchsweeperr:latest
```

On Unraid, add a container with repository `senaxx/watchsweeperr:latest`, port `4173` and a path mapping from your appdata folder to `/app/data`.

Then open `http://<server>:4173`.

### First start

1. Create your account on the setup screen. Until an account exists, the app is open to anyone who can reach it, so do this right away.
2. Go to **Settings**, enter the base URL and API key for Seerr, Tautulli, Radarr and Sonarr, and use **Test connection** for each.
3. Switch off **Demo mode** and save.
4. Click **Check now** on the overview.

Use base URLs without `/api` or `/home`, for example `http://192.168.1.200:7878`. A local address is more reliable than a public domain behind a reverse proxy.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4173` | Port the web interface listens on |
| `WATCHSWEEPERR_DATA_DIR` | `/app/data` | Folder for settings, state and the account |
| `TZ` | (none) | Time zone for dates in the interface and logs |

### Data folder

| File | Contents |
|---|---|
| `settings.json` | Service URLs and API keys, rules and preferences |
| `state.json` | Latest scan results, ignored items and the activity log |
| `auth.json` | Your username, salted password hash and session key |

API keys are stored in plain text in `settings.json`. Keep the folder readable only by the container.

### Account and security

- You stay signed in for 30 days per browser. **Sign out** is the icon in the sidebar footer.
- Change your username or password under **Settings → Account**. This signs out all other devices.
- **Forgot your password?** Delete `auth.json` from the data folder and open the app. You get the setup screen again; your settings and data stay.
- A saved API key is only ever sent to the URL it was saved for. When you change a service URL, enter its API key again.
- The app serves plain HTTP. Put it behind an HTTPS reverse proxy before exposing it outside your home network.

## Development

Requires Node.js 24.

```bash
npm install
npm run dev
```

`npm run dev` starts the server with the Vite dev middleware on `http://localhost:4173`, using `./data` for its files. Start in demo mode or with test API keys; a live configuration can delete real media.

| Command | What it does |
|---|---|
| `npm test` | Runs the test suite (Vitest) |
| `npm run build` | Type-checks and builds the frontend into `dist/` |
| `npm run check` | Tests and build together |

### Project layout

```
server/        Express API, scan logic, service clients, sign-in
  app.ts             Routes and removal flow
  syncEngine.ts      Turns Seerr requests and Tautulli history into suggestions
  apiClients.ts      Seerr, Tautulli, Radarr and Sonarr calls
  automaticRemoval.ts  Per-user automatic removal rules
  auth.ts            Account, password hashing and session cookies
  settingsStore.ts / stateStore.ts  JSON files in the data folder
src/           React interface
  components/        Overview, activity, settings, dialogs, sign-in
  translations.ts    Dutch and English interface text
  i18n.ts            Translation of server messages for the English interface
shared.ts      Types shared by server and interface
genres.ts      TMDB genre names in both languages
```

### Building the image

```bash
docker build -t senaxx/watchsweeperr:latest .
docker push senaxx/watchsweeperr:latest
```

The build runs the tests and stops if any fail.
