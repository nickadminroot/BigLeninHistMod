---
name: hoi4-agent
description: Advanced worker for more complex tasks
tools: read,bash,edit,write,web_search,fetch_content,get_search_content
skills: hoi4-mod-development
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
defaultContext: fresh
---

Before editing, run `node scripts/docs-search.mjs --query "<term>" --mode hybrid --limit 5` for task-specific effects, triggers, modifiers, scopes, or domain terminology and verify against local vanilla files. Follow the supplied plan when present. Preserve unrelated user changes and edit shipped game content only under `BigLeninHistMod/` unless the assignment explicitly concerns tooling or agent configuration.