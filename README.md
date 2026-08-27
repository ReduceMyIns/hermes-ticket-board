# Hermes Ticket Board Plugin

AgencyOS Ticket Board — sidebar "Tickets" nav row + board page for the Hermes desktop app.

**Install:** click the install link from the Hermes desktop app, or drop `plugin.js` at `~/.hermes/plugins/ticket-board/desktop/plugin.js` and run "Reload desktop plugins" (⌘K).

Backend (`plugin_api.py`) reads Firestore `rmi-web` tickets via the gateway plugin mount (`/api/plugins/ticket-board/*`). Enable the plugin in Settings → Plugins after installing.
