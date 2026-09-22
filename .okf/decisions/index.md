# Decisions

* [Minimum Chrome 138](minimum-chrome-138.md) - Since 0.8.0 the manifest declares minimum_chrome_version 138, the first stable Chrome with the global LanguageModel for extensions, so every feature test and fallback for older Chrome was deleted, at the cost of users on older Chrome no longer receiving updates.
* [No host permissions](no-host-permissions.md) - TabOrdo declares no host_permissions, relying on activeTab plus scripting for its only page injections (/vol and the lock title badge), so Chrome Web Store review stays fast at the cost of reaching only the tab the user just acted on.
