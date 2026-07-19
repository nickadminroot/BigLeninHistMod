# Отложенная генерация иконок фокусов

Этот пайплайн отделяет разработку фокусов от генерации изображений. Агенты создают рабочие фокусы с временными иконками и независимые manifest-файлы. ComfyUI или другой генератор запускается позже одной явной пакетной операцией.

## Основной принцип

Для каждого нового фокуса существуют три стадии:

1. **`pending`** — фокус использует существующую fallback-иконку, manifest хранит промпт, DDS ещё нет.
2. **`ready`** — DDS уже получен, но ссылка в фокусе ещё не переключена.
3. **`applied`** — DDS зарегистрирован в GFX, а фокус использует новую custom-иконку.

До стадии `applied` мод остаётся рабочим: отсутствующий DDS никогда не указывается из игрового скрипта.

Источник истины — каталог [`icon-manifests/focus/`](icon-manifests/focus/). Один фокус соответствует одному файлу `<focus_id>.json`.

## 1. Что делает агент при создании фокуса

В новом фокусе агент ставит подходящую существующую иконку:

```txt
focus = {
    id = TAG_my_new_focus
    icon = GFX_goal_generic_construct_infrastructure
    # ...
}
```

Затем из корня репозитория создаёт manifest:

```powershell
rtk python scripts/icon-manifest.py new `
  --focus-id "TAG_my_new_focus" `
  --source-file "common/national_focus/country.txt" `
  --fallback-icon "GFX_goal_generic_construct_infrastructure" `
  --prompt "A heavy freight locomotive crossing a steel railway bridge, with tanker cars and signal lamps behind it"
```

`source-file` задаётся относительно `BigLeninHistMod/`.

Промпт должен описывать конкретную композицию:

- один хорошо читаемый центральный объект;
- один-два вспомогательных объекта;
- простой фон;
- исторически подходящие предметы 1930–1940-х годов.

Не надо добавлять общие указания про стиль, рамку, медаль, отсутствие текста и т. п. Пайплайн добавит preset `hoi4_focus_v1` автоматически.

Плохо:

```text
Economic recovery, national strength and industrial progress
```

Хорошо:

```text
A blast furnace pouring molten steel, with crossed industrial hammers and factory smokestacks behind it
```

После этого агент запускает только быструю проверку:

```powershell
rtk python scripts/icon-manifest.py validate
rtk python scripts/icon-manifest.py status
```

Агент **не запускает ComfyUI**, не создаёт DDS/GFX и не заменяет fallback-иконку.

## 2. Как это работает с несколькими параллельными ветками

Manifest намеренно разбит на отдельные файлы, а не хранится одним большим JSON/таблицей:

```text
icon-manifests/focus/
├── FRA_expand_the_arsenals.json
├── ITA_reorganize_the_high_command.json
└── SOV_new_industrial_centers.json
```

Поэтому параллельные ветки обычно меняют разные файлы:

- ветка Франции добавляет французский фокус и `FRA_....json`;
- ветка Италии добавляет итальянский фокус и `ITA_....json`;
- ветка СССР добавляет советский фокус и `SOV_....json`.

Общий `deferred_focus_icons.gfx` на этом этапе не трогается, поэтому искусственных merge-конфликтов из-за порядка записей нет. Ветка коммитит вместе:

1. файл дерева фокусов;
2. английскую/русскую локализацию;
3. `icon-manifests/focus/<focus_id>.json`.

Если две ветки создают один и тот же `focus_id`, конфликт manifest-файла полезен: это реальная коллизия идентификатора, которую нельзя автоматически скрывать.

Manifest-подход устраняет общий конфликт очереди и GFX, но не может устранить конфликт самого дерева: две ветки, одновременно редактирующие один `common/national_focus/country.txt`, всё ещё могут потребовать обычного ручного merge. `sync` ищет фокус по `id`, а не по номеру строки, поэтому перемещение блока фокуса после merge не ломает manifest.

### Рекомендуемый порядок интеграции

1. Слить feature-ветки в общую интеграционную ветку.
2. Запустить:

   ```powershell
   rtk python scripts/icon-manifest.py validate
   rtk python scripts/icon-manifest.py status
   ```

3. Одной отдельной сессией сгенерировать/импортировать изображения.
4. Выполнить `sync`.
5. Проверить GFX и игровые ссылки, затем закоммитить итоговый пакет assets.

Не следует запускать `sync` независимо в каждой feature-ветке. Это преждевременно изменит общие focus-файлы и сгенерированный GFX, что создаст лишние конфликты. Генерацию лучше считать отдельной интеграционной стадией.

Если после первого batch в интеграционную ветку добавили ещё фокусы, команда `sync` безопасно пересоберёт GFX по всем уже готовым manifest-файлам и применит только новые готовые ссылки.

## 3. Пакетная генерация через ComfyUI

### Требования

- ComfyUI запущен на `http://localhost:8188`;
- Z-Image GGUF model доступна как `z-image-Q8_0.gguf`;
- Python-пакеты `Pillow` и `rembg`;
- желательно наличие ImageMagick (`magick`), иначе используется Pillow DDS writer.

Пример запуска ComfyUI:

```bat
cd /d "G:\ComfyUI"
python main.py --listen 127.0.0.1 --port 8188
```

Посмотреть очередь:

```powershell
rtk python scripts/icon-manifest.py status
```

Сгенерировать первые десять pending-иконок и сразу применить их:

```powershell
rtk python scripts/icon-manifest.py generate --limit 10 --sync
```

Только конкретные фокусы:

```powershell
rtk python scripts/icon-manifest.py generate `
  --ids "FRA_expand_the_arsenals,ITA_reorganize_the_high_command" `
  --sync
```

Перегенерировать одну иконку:

```powershell
rtk python scripts/icon-manifest.py generate `
  --ids "FRA_expand_the_arsenals" `
  --force `
  --sync
```

Генерация вызывается только этой явной командой. `new`, `validate`, `status`, `export` и `sync` сами ComfyUI не запускают.

## 4. Использование другого генератора

Экспортировать переносимый JSONL:

```powershell
rtk python scripts/icon-manifest.py export `
  --output "build/icon-requests.jsonl"
```

Каждая строка содержит:

- `id` и `sprite_name`;
- исходный `subject_prompt`;
- готовые `positive_prompt` и `negative_prompt`;
- размер генерации;
- ожидаемое имя результата и путь DDS.

Внешний инструмент должен вернуть прозрачный PNG/WebP либо готовый DDS. Поддерживаемые имена:

```text
<focus_id>.png                         # рекомендуется
GFX_focus_custom_<focus_id>.png
focus_custom_<focus_id>.png
```

Для DDS используются те же основы имён с расширением `.dds`. Готовый DDS должен иметь размер 100x88.

Импортировать результаты и применить их:

```powershell
rtk python scripts/icon-manifest.py ingest `
  --input-dir "G:/generated-focus-icons" `
  --sync
```

PNG/WebP автоматически уменьшается до 100x88 и конвертируется в DDS. Удаление фона намеренно не выполняется при импорте: внешний генератор должен вернуть уже подготовленную прозрачность. Если прозрачных пикселей нет, будет выведено предупреждение.

## 5. Что делает `sync`

`sync` выполняет детерминированную интеграцию готовых файлов:

1. проверяет все manifest-файлы и соответствующие focus ID;
2. находит manifest-файлы, для которых DDS уже существует;
3. полностью пересобирает `BigLeninHistMod/interface/deferred_focus_icons.gfx` в стабильном порядке;
4. внутри блока нужного фокуса заменяет только объявленный `fallback_icon` на `sprite_name`;
5. отказывается менять неожиданную третью иконку, чтобы не затереть ручное изменение;
6. повторно валидирует итоговое состояние.

Manifest после `sync` не удаляется. Он нужен для воспроизводимости, аудита промптов и будущей перегенерации.

Можно отдельно импортировать файлы, проверить их, а затем применить:

```powershell
rtk python scripts/icon-manifest.py ingest --input-dir "G:/generated-focus-icons"
rtk python scripts/icon-manifest.py status
rtk python scripts/icon-manifest.py sync
```

## 6. Команды и состояния

```powershell
# Создать manifest
rtk python scripts/icon-manifest.py new --help

# Проверить структуру manifest и ссылки в focus-файлах
rtk python scripts/icon-manifest.py validate

# pending / ready / applied / broken
rtk python scripts/icon-manifest.py status

# Машиночитаемый статус
rtk python scripts/icon-manifest.py status --json

# Экспорт для внешнего генератора
rtk python scripts/icon-manifest.py export --output "build/icon-requests.jsonl"

# Импорт готовых изображений
rtk python scripts/icon-manifest.py ingest --input-dir "G:/generated-focus-icons"

# Регистрация GFX и переключение focus-ссылок
rtk python scripts/icon-manifest.py sync
```

Значения статуса:

- `pending` — DDS отсутствует, fallback активен;
- `ready` — DDS существует, fallback ещё активен;
- `applied` — DDS существует, custom sprite активен;
- `broken` — source/reference/texture находятся в несовместимом состоянии.

## 7. Финальная проверка

После `sync`:

```powershell
rtk python scripts/icon-manifest.py validate
rtk python scripts/validate-focus-icon-references.py
rtk node scripts/hoi4-mcp-cli.js gui_validate --check_textures true
```

`gui_validate` проверяет весь интерфейс мода и может показать уже существующие baseline-проблемы с vanilla-спрайтами. Для этого пайплайна обязательны успешные `icon-manifest.py validate` и `validate-focus-icon-references.py`; общий GUI-отчёт нужно сравнивать с предыдущим baseline.

Также нужно проверить в игре читаемость иконок в дереве фокусов. Windows smoke test запускается только по отдельному явному запросу.

## Структура файлов

```text
icon-manifests/focus/<focus_id>.json                 # запрос и промпт
scripts/icon-manifest.py                             # queue/export/import/sync
scripts/generate-single-focus-icon.py                # ComfyUI + post-processing одного asset
BigLeninHistMod/gfx/interface/goals/focus_custom_*.dds
BigLeninHistMod/interface/deferred_focus_icons.gfx   # генерируется sync
```

Существующий `BigLeninHistMod/interface/custom_focus_icons.gfx` остаётся для уже выпущенных старых иконок. Новые manifest-иконки регистрируются только в `deferred_focus_icons.gfx`.
