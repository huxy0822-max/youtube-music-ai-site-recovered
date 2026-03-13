# youtube-music-ai-site

This project was recovered from the deployment directory behind `http://107.172.16.237:8090/` on March 13, 2026.

## What is included

- `server.js`: Node.js HTTP server and proxy endpoints
- `youtube_music_ai_planner.html`: main UI page served at `/`
- `index.html`: secondary HTML asset found in the deployed directory
- `yt_users_db.example.json`: sanitized sample database

## What is intentionally excluded

- `yt_users_db.json`: the live runtime database from the server was downloaded locally in the raw backup, but it is not committed here because it contains user account data and saved presets/drafts

## Run locally

```bash
node server.js
```

Default port: `3000`

## Run with Docker

```bash
docker build -t youtube-music-ai-site .
docker run --rm -p 3000:3000 youtube-music-ai-site
```

## Raw backup

The complete downloaded deployment backup, including the live `yt_users_db.json`, is stored locally outside this repo in the sibling raw backup directory and zip archive.
