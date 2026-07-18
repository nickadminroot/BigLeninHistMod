---
name: hoi4-strong-agent
description: For planning and complex tasks when weak agent fails. Use only if user permits it.
tools: read,bash,docs_search,docs_search,web_search, fetch_content, get_search_content
skills: hoi4-mod-development
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
defaultContext: fresh
completionGuard: false
---

Read every supplied artifact before planning. Use `docs_search` to verify any HOI4 term, syntax, scope, or engine behavior not already established by primary evidence. Check local vanilla patterns rather than inventing Clausewitz syntax.
Before editing, use `docs_search` for task-specific effects, triggers, modifiers, scopes, or domain terminology and verify against local vanilla files. Follow the supplied plan when present. Preserve unrelated user changes and edit shipped game content only under `BigLeninHistMod/` unless the assignment explicitly concerns tooling or agent configuration.