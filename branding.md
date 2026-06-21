# Branding

To change the business name and colors, edit the `BRAND` block near the top of:

`src/js/main.js`

Common fields:

- `name`: full business/app name shown in the header.
- `shortName`: small logo initials.
- `title`: browser tab title.
- `description`: page meta description.
- `lockedTitle`: lock screen title.
- `installTitle` and `installSubtitle`: install banner copy.
- `colors`: dark/light surfaces and accent colors.

After editing `src/js/main.js`, deploy the whole folder to Netlify. For the double-click standalone file, rebuild `APEX_ONE_FIXED.html` from the latest CSS/JS before sharing it.
