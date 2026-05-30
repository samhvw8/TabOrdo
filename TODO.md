# TODO

## CI/CD

- [x] Publish workflow using `wxt submit` for Chrome Web Store
- [x] Set GitHub secrets: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`
- [ ] Move GCP OAuth app from testing to production for long-lived refresh tokens
- [ ] Test `workflow_dispatch` trigger with `--dry-run` first

## Setup Credentials

| Step | Action |
|------|--------|
| 1 | Go to [Google Cloud Console](https://console.cloud.google.com) |
| 2 | Create OAuth 2.0 Client ID (Desktop app type) |
| 3 | Enable Chrome Web Store API |
| 4 | Get refresh token via OAuth consent flow |
| 5 | Add secrets in GitHub repo Settings > Secrets > Actions |

## Related

- [PRIVACY.md](PRIVACY.md)
- [CHANGELOG.md](CHANGELOG.md)
