# LLM-Based Translation for Remaining Keys

After auto-translation from vanilla (~55% coverage), remaining keys are custom mod content that needs LLM or manual translation.

## Approach

Use an OpenAI-compatible API to batch-translate TODO-marked keys. The script `scripts/translate_llm.py` handles this.

## API Configuration

The script uses environment variables (loaded from `.env`):

```
LLM_API_BASE=https://opencode.ai/zen/go/v1
LLM_API_KEY=your-api-key
LLM_MODEL=deepseek-v4-flash
```

Or pass via command line:
```bash
python translate_llm.py --api-key "sk-xxx" --model deepseek-v4-flash
```

## How It Works

1. Scans all `*_l_russian.yml` files for `/* TODO */` markers
2. Batches keys (default 50 per request)
3. Sends structured prompt to LLM with context:
   - Key name (preserves context like TAG_, _tt suffix)
   - English value to translate
   - Rules: keep §-codes, £-icons, $-variables, script expressions unchanged
4. Parses response, applies translations to files
5. Saves progress to `.translate_progress.json` for resume

## Prompt Template

The LLM receives:
```
Translate these Hearts of Iron IV game localization keys from English to Russian.

RULES:
1. Keep ALL formatting codes exactly as-is: §Y, §R, §G, §!, £icons, $VARIABLES$, \\n, %1 %2
2. Keep [THIS.GetName], [FROM.GetNameDef] and similar script expressions unchanged
3. Use game-appropriate Russian terminology
4. Keep country abbreviations (GER, SOV, USA, ENG, etc.) as-is
5. Return ONLY the translations in format: key: "translation"

KEYS TO TRANSLATE:
  key1: English value 1
  key2: English value 2
```

## Usage

```bash
# Full run
python translate_llm.py

# Resume after interruption
python translate_llm.py --resume

# Preview without API calls
python translate_llm.py --dry-run

# Custom batch size and model
python translate_llm.py --batch-size 30 --model gpt-4o-mini
```

## Cost Estimation

- ~13,000 TODO keys typically remain
- ~200 tokens per key average
- DeepSeek V4 Flash: very cheap (~$0.50-2 total)
- GPT-4o-mini: ~$2-5 total
- Batch of 50 keys ≈ 1 API call

## Quality Considerations

- LLMs handle HOI4 context well (focus trees, events, decisions)
- Gaming terminology translates better than generic machine translation
- §-codes and $-variables preserved by prompt instructions
- For very long values (>300 chars), truncate in prompt but translate fully
- Review sample outputs before full run — LLM may occasionally hallucinate formatting codes
