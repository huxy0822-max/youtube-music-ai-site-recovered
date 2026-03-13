FROM node:22-alpine

WORKDIR /app

COPY server.js index.html youtube_music_ai_planner.html yt_users_db.example.json ./

EXPOSE 3000

CMD ["sh", "-lc", "[ -f yt_users_db.json ] || cp yt_users_db.example.json yt_users_db.json; exec node server.js"]
