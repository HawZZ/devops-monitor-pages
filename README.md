# DevOps Monitor Pages

Static GitHub Pages frontend for the server-side DevOps monitor API.

## Backend

Default API base is configured in `config.js`.

The backend must:

- expose HTTPS, currently through Cloudflare Tunnel;
- allow this Pages origin in `MONITOR_CORS_ORIGINS`;
- use `MONITOR_COOKIE_SAMESITE=none` and `MONITOR_COOKIE_SECURE=true`.

Without a custom domain, Cloudflare Quick Tunnel URLs can change. Use the settings button in the page to update the backend URL, or update `config.js` and redeploy.

## Local preview

```bash
npm install
npm run preview
```

Open <http://127.0.0.1:8088/>.

## Playwright screenshot

```bash
npm install
npm run screenshot
```

By default this starts a temporary local server and writes `/tmp/devops-login-desktop.png`.
