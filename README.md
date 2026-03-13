# youtube-music-ai-site

## 中文说明

这个项目是在 2026 年 3 月 13 日，从 `http://107.172.16.237:8090/` 对应服务器部署目录中恢复出来的源码版本。

### 包含内容

- `server.js`：Node.js HTTP 服务端与代理接口
- `youtube_music_ai_planner.html`：主界面页面，站点根路径 `/` 实际返回这个页面
- `index.html`：部署目录中存在的另一个 HTML 文件
- `yt_users_db.example.json`：脱敏后的示例数据库文件

### 有意排除的内容

- `yt_users_db.json`：线上运行时数据库已完整下载到本地原始备份中，但没有提交到这个 GitHub 仓库，因为其中包含用户账号数据、预设和草稿

### 本地运行

```bash
node server.js
```

默认端口：`3000`

### Docker 运行

```bash
docker build -t youtube-music-ai-site .
docker run --rm -p 3000:3000 youtube-music-ai-site
```

### 原始备份

完整的部署目录备份（包括真实的 `yt_users_db.json`）保存在仓库之外的本地原始备份目录和 zip 压缩包中，没有放进当前公开仓库。

## English

This project was recovered on March 13, 2026 from the deployment directory behind `http://107.172.16.237:8090/`.

### Included files

- `server.js`: Node.js HTTP server and proxy endpoints
- `youtube_music_ai_planner.html`: main UI page, which is what the site serves at `/`
- `index.html`: secondary HTML file found in the deployed directory
- `yt_users_db.example.json`: sanitized sample database

### Intentionally excluded

- `yt_users_db.json`: the live runtime database was downloaded into the local raw backup, but it is not committed to this GitHub repository because it contains account data, presets, and drafts

### Run locally

```bash
node server.js
```

Default port: `3000`

### Run with Docker

```bash
docker build -t youtube-music-ai-site .
docker run --rm -p 3000:3000 youtube-music-ai-site
```

### Raw backup

The complete deployment backup, including the live `yt_users_db.json`, is stored locally outside this repository in the raw backup folder and zip archive, and is not included in this public repo.
