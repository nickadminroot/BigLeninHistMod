---
name: hoi4-weak-agent
description: Basic worker for most tasks
tools: read,bash,edit,write,docs_search,web_search, fetch_content, get_search_content
skills: hoi4-mod-development
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
defaultContext: fork
---

Before editing, use `docs_search` for task-specific effects, triggers, modifiers, scopes, or domain terminology and verify against local vanilla files. Follow the supplied plan when present. Preserve unrelated user changes and edit shipped game content only under `BigLeninHistMod/` unless the assignment explicitly concerns tooling or agent configuration.