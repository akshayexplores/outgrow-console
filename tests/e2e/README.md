# End-to-end tests

```
npm run build && npm start            # or set E2E_BASE_URL to a deployment
npx playwright test --project=public-desktop --project=public-mobile     # no credentials needed
E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… E2E_PM_EMAIL=… (etc.) npx playwright test --project=authed
```

The `authed` project signs in with the optional password sign-in. Create one test user per persona in a **staging** Supabase project (add each to the roster with the matching role, then set a password from Password & account) and pass their credentials as environment variables. Specs without credentials skip themselves. Do not point `authed` at production data: the log-flow spec writes a conversation.

Personas: `ADMIN`, `ENGINEER`, `PM`, `LEAD` (delivery lead), `LEADER` (Outgrow Leader).
