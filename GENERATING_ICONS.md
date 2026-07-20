# Отложенная генерация иконок фокусов, идей и динамических модификаторов

Пайплайн отделяет разработку игрового контента от генерации изображений. Агенты создают рабочие фокусы, идеи и динамические модификаторы с временными иконками и независимые manifest-файлы. ComfyUI или другой генератор запускается позже одной явной пакетной операцией.

Поддерживаются:

| Тип | Manifest | Поле скрипта до генерации | Custom reference | DDS |
|---|---|---|---|---|
| Фокус | `icon-manifests/focus/<focus_id>.json` | `icon = <fallback GFX>` | `GFX_focus_custom_<focus_id>` | 100x88 |
| Идея | `icon-manifests/idea/<idea_id>.json` | `picture = <fallback>` | `custom_<idea_id>` | 65x67 |
| Динамический модификатор | `icon-manifests/dynamic_modifier/<modifier_id>.json` | `icon = <fallback GFX>` | `GFX_idea_custom_dynamic_modifier_<modifier_id>` | 65x67 |

Для идеи движок автоматически преобразует `picture = custom_TAG_spirit` в sprite lookup `GFX_idea_custom_TAG_spirit`.

## Основной принцип

Для каждого asset существуют три нормальные стадии:

1. **`pending`** — игровой скрипт использует существующий fallback, manifest хранит промпт, DDS ещё нет.
2. **`ready`** — DDS получен, но ссылка в скрипте ещё не переключена.
3. **`applied`** — DDS зарегистрирован в GFX, скрипт использует custom reference.

До стадии `applied` мод остаётся рабочим: отсутствующий DDS никогда не указывается из игрового скрипта.

## 1. Что делает агент

### Новый фокус

Сначала агент ставит существующую валидную иконку:

```txt
focus = {
    id = TAG_my_new_focus
    icon = GFX_goal_generic_construct_infrastructure
}
```

Затем создаёт manifest из корня репозитория:

```powershell
rtk python scripts/icon-manifest.py new `
  --type focus `
  --id "TAG_my_new_focus" `
  --source-file "common/national_focus/country.txt" `
  --fallback "GFX_goal_generic_construct_infrastructure" `
  --prompt "A heavy freight locomotive crossing a steel railway bridge, with tanker cars and signal lamps behind it"
```

Старые параметры `--focus-id` и `--fallback-icon` также поддерживаются.

### Новая идея

Идея также получает существующий fallback `picture` без префикса `GFX_idea_`:

```txt
TAG_industrial_spirit = {
    picture = generic_production_bonus
    # ...
}
```

Manifest создаётся так:

```powershell
rtk python scripts/icon-manifest.py new `
  --type idea `
  --id "TAG_industrial_spirit" `
  --source-file "common/ideas/country.txt" `
  --fallback "generic_production_bonus" `
  --prompt "A blast furnace pouring molten steel, with crossed industrial hammers and factory smokestacks behind it"
```

Эквивалентные сокращения: `--idea-id` и `--fallback-picture`.

### Новый динамический модификатор

Динамический модификатор использует полное имя GFX в поле `icon`:

```txt
TAG_industrial_dynamic_modifier = {
    icon = GFX_idea_generic_production_bonus
    # ...
}
```

Manifest:

```powershell
rtk python scripts/icon-manifest.py new `
  --type dynamic_modifier `
  --id "TAG_industrial_dynamic_modifier" `
  --source-file "common/dynamic_modifiers/country.txt" `
  --fallback "GFX_idea_generic_production_bonus" `
  --prompt "A large steel gear behind a glowing blast furnace and crossed industrial hammers"
```

Сокращения: `--dynamic-modifier-id` и `--fallback-icon`.

`source-file` всегда задаётся относительно `BigLeninHistMod/`.

После создания контента агент запускает только быструю проверку:

```powershell
rtk python scripts/icon-manifest.py validate
rtk python scripts/icon-manifest.py status
```

Агент **не запускает ComfyUI**, не создаёт DDS/GFX и не заменяет fallback reference.

## 2. Как писать промпты

Промпт должен описывать конкретную композицию:

- один хорошо читаемый центральный объект;
- максимум один-два вспомогательных объекта;
- простой фон;
- исторически подходящие предметы 1930–1940-х годов;
- силуэт, который останется понятным после уменьшения.

Не надо повторять общие указания про стиль, эпоху, отсутствие текста и однотонный фон — preset добавит их автоматически.

### Для фокусов

Preset `hoi4_focus_v1` добавляет металлический медальон, рамку и лавровые ветви. Описывайте объект **внутри** композиции, а не саму рамку.

Плохо:

```text
Economic recovery, national strength and industrial progress
```

Хорошо:

```text
A blast furnace pouring molten steel, with crossed industrial hammers and factory smokestacks behind it
```

### Для идей и динамических модификаторов

Presets `hoi4_idea_v1` и `hoi4_dynamic_modifier_v1` создают отдельный символ **без рамки, медальона и лавров**. Композиция должна быть ещё проще, поскольку итоговый размер — 65x67. Для динамического модификатора объект должен отражать изменяемое состояние — промышленность, армию, регион, сопротивление или политический режим.

Плохо:

```text
Army reform, better organization and higher morale
```

Хорошо:

```text
A steel officer's helmet above two crossed field marshal batons
```

Не просите модель рисовать читаемый текст, лозунги, названия приказов или номера частей.

## 3. Параллельные ветки

Один asset соответствует одному файлу:

```text
icon-manifests/
├── focus/
│   ├── FRA_expand_the_arsenals.json
│   └── SOV_new_industrial_centers.json
├── idea/
│   ├── FRA_rearmament_spirit.json
│   └── SOV_industrial_mobilization.json
└── dynamic_modifier/
    ├── FRA_rearmament_dynamic_modifier.json
    └── SOV_industrial_mobilization_dynamic_modifier.json
```

Параллельные ветки обычно добавляют разные manifest-файлы и не трогают общие generated GFX. Ветка коммитит вместе:

1. focus/idea/dynamic modifier script;
2. английскую и русскую локализацию;
3. соответствующий manifest.

Если две ветки создают один manifest с одинаковыми типом и ID, конфликт полезен: это реальная коллизия. Одинаковые ID разных типов допустимы, поскольку они находятся в разных каталогах; при фильтрации команд используйте `--type`.

Manifest-подход устраняет конфликт общей очереди и GFX, но не конфликт самого игрового файла: две ветки, редактирующие один `country.txt`, всё ещё могут потребовать ручного merge. `sync` ищет блок по ID, а не по номеру строки.

### Порядок интеграции

1. Слить feature-ветки в интеграционную ветку.
2. Выполнить `validate` и `status`.
3. Одной отдельной сессией сгенерировать или импортировать изображения.
4. Выполнить `sync`.
5. Проверить GFX и ссылки, затем закоммитить итоговые assets.

Не запускайте `sync` независимо в каждой feature-ветке: это преждевременно изменит общие script-файлы и generated GFX. Если позже добавились новые manifests, повторный `sync` детерминированно пересоберёт GFX по всем готовым assets.

## 4. Пакетная генерация через ComfyUI

### Требования

- ComfyUI на `http://localhost:8188`;
- Z-Image GGUF `z-image-Q8_0.gguf`;
- Python-пакеты `Pillow` и `rembg`;
- желательно ImageMagick (`magick`), иначе используется Pillow DDS writer.

```bat
cd /d "G:\ComfyUI"
python main.py --listen 127.0.0.1 --port 8188
```

Все pending assets:

```powershell
rtk python scripts/icon-manifest.py status
rtk python scripts/icon-manifest.py generate --limit 10 --sync
```

Только идеи или динамические модификаторы:

```powershell
rtk python scripts/icon-manifest.py generate --type idea --limit 10 --sync
rtk python scripts/icon-manifest.py generate --type dynamic_modifier --limit 10 --sync
```

Конкретные идеи:

```powershell
rtk python scripts/icon-manifest.py generate `
  --type idea `
  --ids "FRA_rearmament_spirit,SOV_industrial_mobilization" `
  --sync
```

Перегенерация:

```powershell
rtk python scripts/icon-manifest.py generate `
  --type idea `
  --ids "FRA_rearmament_spirit" `
  --force `
  --sync
```

Только `generate` запускает ComfyUI. Команды `new`, `validate`, `status`, `export`, `ingest` и `sync` сами генерацию не запускают.

## 5. Другой генератор

Экспортировать все запросы:

```powershell
rtk python scripts/icon-manifest.py export --output "build/icon-requests.jsonl"
```

Только один тип:

```powershell
rtk python scripts/icon-manifest.py export `
  --type idea `
  --output "build/idea-icon-requests.jsonl"
rtk python scripts/icon-manifest.py export `
  --type dynamic_modifier `
  --output "build/dynamic-modifier-icon-requests.jsonl"
```

JSONL содержит тип, ID, subject/full prompts, размер генерации, ожидаемый размер DDS и путь назначения. Для динамических модификаторов используйте `--type dynamic_modifier`.

Рекомендуемое имя результата включает тип и исключает коллизию одинаковых ID:

```text
focus_<focus_id>.png
idea_<idea_id>.png
dynamic_modifier_<modifier_id>.png
```

Также поддерживаются:

```text
<asset_id>.png
GFX_focus_custom_<focus_id>.png
focus_custom_<focus_id>.png
GFX_idea_custom_<idea_id>.png
idea_custom_<idea_id>.png
GFX_idea_custom_dynamic_modifier_<modifier_id>.png
idea_custom_dynamic_modifier_<modifier_id>.png
```

Допустимы `.png`, `.webp` и `.dds`. Внешний генератор должен подготовить прозрачность. PNG/WebP автоматически конвертируются в 100x88 для фокусов или 65x67 для идей и динамических модификаторов. Готовый DDS уже должен иметь правильный размер.

```powershell
rtk python scripts/icon-manifest.py ingest `
  --input-dir "G:/generated-icons" `
  --sync
```

При одинаковых ID разных типов импортируйте с префиксами `focus_`, `idea_` или `dynamic_modifier_` либо используйте отдельные каталоги и `--type`.

## 6. Что делает `sync`

`sync`:

1. проверяет manifests и соответствующие focus/idea/dynamic modifier ID;
2. находит manifests с готовым DDS;
3. пересобирает в стабильном порядке:
   - `BigLeninHistMod/interface/deferred_focus_icons.gfx`;
   - `BigLeninHistMod/interface/deferred_idea_icons.gfx`;
   - `BigLeninHistMod/interface/deferred_dynamic_modifier_icons.gfx`;
4. заменяет только объявленный fallback:
   - `icon = <fallback>` → `icon = GFX_focus_custom_<id>` для фокуса;
   - `picture = <fallback>` → `picture = custom_<id>` для идеи;
   - `icon = <fallback>` → `icon = GFX_idea_custom_dynamic_modifier_<id>` для динамического модификатора;
5. отказывается затирать неожиданное ручное изменение;
6. повторно валидирует результат.

Manifest после `sync` сохраняется для воспроизводимости и перегенерации.

Можно разделить импорт и применение:

```powershell
rtk python scripts/icon-manifest.py ingest --input-dir "G:/generated-icons"
rtk python scripts/icon-manifest.py status
rtk python scripts/icon-manifest.py sync
```

## 7. Справочник команд

```powershell
# Создать manifest
rtk python scripts/icon-manifest.py new --help

# Проверить всё или один тип
rtk python scripts/icon-manifest.py validate
rtk python scripts/icon-manifest.py validate --type idea

# pending / ready / applied / broken
rtk python scripts/icon-manifest.py status
rtk python scripts/icon-manifest.py status --type idea
rtk python scripts/icon-manifest.py status --json

# Экспорт/импорт
rtk python scripts/icon-manifest.py export --output "build/icon-requests.jsonl"
rtk python scripts/icon-manifest.py ingest --input-dir "G:/generated-icons"

# GFX и script references
rtk python scripts/icon-manifest.py sync
```

`broken` означает, что source/reference/texture находятся в несовместимом состоянии.

## 8. Финальная проверка

```powershell
rtk python scripts/icon-manifest.py validate
rtk python scripts/validate-icon-references.py
rtk node scripts/hoi4-mcp-cli.js gui_validate --check_textures true
```

`gui_validate` проверяет весь интерфейс и может показать существующие baseline-проблемы с vanilla-спрайтами. Для этого пайплайна обязательны успешные первые две проверки; общий GUI-отчёт сравнивается с baseline.

В игре проверьте читаемость фокусов в дереве, идей в окне национальных духов и динамических модификаторов в соответствующих GUI. Windows smoke test запускается только по отдельному явному запросу.

## Структура

```text
icon-manifests/focus/<focus_id>.json
icon-manifests/idea/<idea_id>.json
icon-manifests/dynamic_modifier/<modifier_id>.json
scripts/icon-manifest.py
scripts/generate-single-focus-icon.py
BigLeninHistMod/gfx/interface/goals/focus_custom_*.dds
BigLeninHistMod/gfx/interface/ideas/idea_custom_*.dds
BigLeninHistMod/gfx/interface/ideas/idea_custom_dynamic_modifier_*.dds
BigLeninHistMod/interface/deferred_focus_icons.gfx
BigLeninHistMod/interface/deferred_idea_icons.gfx
BigLeninHistMod/interface/deferred_dynamic_modifier_icons.gfx
```

Старые выпущенные assets остаются в `custom_focus_icons.gfx` и `custom_idea_icons.gfx`. Новые manifest-assets регистрируются только в соответствующих `deferred_*_icons.gfx`. Динамические модификаторы используют idea-sized текстуры, но отдельные sprite names и отдельный generated GFX, чтобы не конфликтовать с идеями с тем же ID.
