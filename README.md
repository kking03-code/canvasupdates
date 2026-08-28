# Assignment Reminder Bot

A Discord bot that tracks your course assignments and automatically posts
reminders in a channel as due dates approach. Built with
[discord.js v14](https://discord.js.org/) and `node-cron`.

## Features

- **Canvas sync**: automatically pulls upcoming assignments (with due dates)
  from your active Canvas courses on a schedule (default every 30 min) and
  on startup, so you don't have to enter anything by hand
- `/syncnow` — manually trigger a Canvas sync on demand
- `/addassignment course title due` — add a one-off assignment manually
  (due format: `YYYY-MM-DD` or `YYYY-MM-DD HH:mm`, 24-hour clock)
- `/assignments` — list everything currently tracked, soonest first, with
  a link back to the assignment in Canvas where available
- `/removeassignment id` — remove an assignment by its ID
- A scheduled job (daily by default) that posts an embed listing anything
  due within the next N days, so nobody has to check manually
- Data is stored in a local `assignments.json` file — no database needed
- Re-syncing is safe: Canvas assignments are matched by their Canvas ID, so
  you'll never get duplicates, and if a due date changes in Canvas the
  reminder will re-fire instead of being silently skipped

## Setup

### 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and click **New Application**.
2. Under **Bot**, click **Reset Token** and copy it — this is your `DISCORD_TOKEN`.
3. Under **General Information**, copy the **Application ID** — this is your `CLIENT_ID`.
4. Under **OAuth2 → URL Generator**, check the `bot` and `applications.commands`
   scopes, and under Bot Permissions check `Send Messages` and `Embed Links`.
   Open the generated URL to invite the bot to your server.
5. In Discord, enable Developer Mode (User Settings → Advanced), then
   right-click your server icon and "Copy Server ID" for `GUILD_ID`, and
   right-click the channel you want reminders posted in for
   `REMINDER_CHANNEL_ID`.

### 2. Get a Canvas API token

1. Log into Canvas and go to **Account** (left sidebar) → **Settings**.
2. Scroll to **Approved Integrations** and click **+ New Access Token**.
3. Give it a purpose like "Discord assignment bot" and generate it.
4. Copy the token **immediately** — Canvas only shows it once. This is
   `CANVAS_API_TOKEN`.
5. Your `CANVAS_BASE_URL` is the domain you use to log into Canvas, e.g.
   `https://yourschool.instructure.com` (no trailing slash, no `/login` etc).

Treat this token like a password:
- Put it only in your local `.env` file — **never** commit it, paste it in
  Discord, or share it in chat.
- `.env` should already be covered by a `.gitignore` if you put this in git
  (add one if not: `echo ".env" >> .gitignore`).
- If it's ever exposed, revoke it from that same Canvas Settings page and
  generate a new one.
- The token grants access to everything your account can see in Canvas, so
  only run this bot somewhere you trust.

By default the bot syncs **all** of your active courses. If you only want
specific ones, find each course's ID in its Canvas URL
(`.../courses/12345`) and set `CANVAS_COURSE_IDS=12345,67890` in `.env`.

### 3. Configure

```bash
cp .env.example .env
```

Fill in `.env` with the values from steps 1–2.

### 4. Install and run

```bash
npm install
npm run deploy-commands   # registers the slash commands with your server
npm start                 # starts the bot
```

The bot logs in, registers its reminder schedule, and starts listening for
slash commands. Leave `npm start` running (or deploy it somewhere like a VPS,
Railway, Render, or a Raspberry Pi) so the daily check keeps firing.

## Configuration reference (`.env`)

| Variable                | Required | Description                                                        |
|--------------------------|:--------:|----------------------------------------------------------------------|
| `DISCORD_TOKEN`          | ✅       | Your bot's secret token                                              |
| `CLIENT_ID`              | ✅       | Your application/client ID (needed for `deploy-commands`)            |
| `GUILD_ID`               | ✅       | The server to register commands in                                   |
| `REMINDER_CHANNEL_ID`    | ✅       | Channel where automated reminders are posted                         |
| `REMINDER_CRON`          | optional | Cron expression for the check (default `0 8 * * *` = 8 AM daily)     |
| `REMINDER_WINDOW_DAYS`   | optional | How many days out counts as "upcoming" (default `3`)                 |
| `CANVAS_BASE_URL`        | optional | Your Canvas domain, e.g. `https://yourschool.instructure.com`        |
| `CANVAS_API_TOKEN`       | optional | Your personal Canvas access token (see step 2 above)                 |
| `CANVAS_COURSE_IDS`      | optional | Comma-separated course IDs to limit sync to (default: all active)    |
| `CANVAS_SYNC_CRON`       | optional | Cron expression for Canvas polling (default `*/30 * * * *`)          |

If `CANVAS_BASE_URL`/`CANVAS_API_TOKEN` are left blank, Canvas sync is
simply skipped — the bot still works fine with manually-added assignments.

## How the reminders work

Once a day (per `REMINDER_CRON`), the bot checks `assignments.json` for
anything due within `REMINDER_WINDOW_DAYS` days and not yet due, and posts
a single embed listing them all. Each assignment is only pinged once per
day (tracked internally), so you won't get spammed with the same item
every time the job runs.

## Notes / next steps you might want

- **Multiple courses/channels**: right now all reminders go to one channel.
  You could extend `assignments.json` entries with a `channelId` field and
  route each reminder accordingly.
- **Recurring assignments**: not built in — each entry is a one-off due date.
- **Permissions**: no role checks are enforced on who can add/remove
  assignments. Add a permission check in `index.js` if you want to restrict
  this to instructors/mods.
- **Persistence**: `assignments.json` is a flat file. Fine for a single
  small server; swap in SQLite or similar if you need concurrent
  read/write safety at scale.
