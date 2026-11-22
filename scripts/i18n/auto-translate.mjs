#!/usr/bin/env node
/**
 * Automatically create safe Ukrainian YAML overlays for Python Arena.
 * Source module content and executable exercises remain unchanged.
 *
 * Examples:
 *   node scripts/i18n/auto-translate.mjs --list
 *   node scripts/i18n/auto-translate.mjs --module 03-variables.yaml
 *   node scripts/i18n/auto-translate.mjs --all
 *   node scripts/i18n/auto-translate.mjs --course
 *
 * Env:
 *   OLLAMA_MODEL=qwen38-128k:latest (replace with a model from `ollama list`)
 *   OLLAMA_URL=http://127.0.0.1:11434
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const content = path.join(root, 'content');
const moduleDir = path.join(content, 'modules');
const ukDir = path.join(content, 'i18n', 'uk');
const model = process.env.OLLAMA_MODEL || 'qwen38-128k:latest';
const baseUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const forced = has('--force');
const named = args.indexOf('--module');
const moduleName = named >= 0 ? args[named + 1] : null;
const list = has('--list');
const all = has('--all');
const course = has('--course');

if (has('--help') || (!list && !all && !course && !moduleName)) {
  console.log(`Python Arena — автоматична українська локалізація через Ollama

Використання:
  --list                         Список перекладених і неперекладених модулів
  --module 03-variables.yaml     Перекласти один модуль
  --all                          Перекласти всі відсутні модулі
  --course                       Доповнити українські назви у course.yaml
  --force                        Перегенерувати обрані модулі (перезаписує ручні зміни)

Змінні середовища:
  OLLAMA_MODEL (типово ${model})
  OLLAMA_URL   (типово ${baseUrl})`);
  process.exit(0);
}
if (moduleName && (!/^[a-zA-Z0-9][\w.-]*\.ya?ml$/.test(moduleName) || moduleName.includes('..'))) {
  throw new Error('--module: вкажи лише назву YAML-файлу, наприклад 03-variables.yaml');
}
if (moduleName && !fs.existsSync(path.join(moduleDir, moduleName))) {
  throw new Error(`Файл не знайдено: content/modules/${moduleName}`);
}

const readYaml = (file) => YAML.parse(fs.readFileSync(file, 'utf8'));
const writeYaml = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write atomically, so an interrupted call cannot leave a half-written overlay.
  const tmp = file + `.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, '# Українська локалізація Python Arena. Згенеровано ШІ; перевірити перед публікацією.\n' + YAML.stringify(obj, { lineWidth: 0 }), 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
};
const names = fs.readdirSync(moduleDir).filter((s) => /^\d+-.+\.yaml$/.test(s)).sort();

if (list) {
  for (const name of names) {
    console.log(`${fs.existsSync(path.join(ukDir, 'modules', name)) ? '✅' : '— '} ${name}`);
  }
  process.exit(0);
}

// A translated step may still need certain *English* technical terms, because
// content/topics.yaml validates that a term is introduced at its designated step.
const termsByStep = new Map();
const topicsFile = path.join(content, 'topics.yaml');
if (fs.existsSync(topicsFile)) {
  for (const entry of readYaml(topicsFile) ?? []) {
    if (typeof entry.term !== 'string') continue;
    for (const stepId of entry.steps ?? []) {
      if (!termsByStep.has(stepId)) termsByStep.set(stepId, new Set());
      termsByStep.get(stepId).add(entry.term);
    }
  }
}

// Protect code blocks, inline code, URLs and the exact delimiter required by
// build-content.mjs. The LLM sees tokens but not the protected contents.
const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|\*\*Your turn:\*\*|https?:\/\/[^\s)]+|\[\[[^\]\n]*\]\]/g;
function maskText(source) {
  const chunks = [];
  const masked = source.replace(PROTECTED, (match) => {
    const token = `__PYARENA_KEEP_${String(chunks.length).padStart(4, '0')}__`;
    chunks.push({ token, original: match });
    return token;
  });
  return { masked, chunks };
}
function unmaskText(translated, chunks) {
  let previous = -1;
  for (const { token } of chunks) {
    const index = translated.indexOf(token);
    if (index < 0 || index <= previous || translated.indexOf(token, index + token.length) !== -1) {
      throw new Error(`Модель змінила або переставила захищений маркер ${token}`);
    }
    previous = index;
  }
  if (/__PYARENA_KEEP_\d+__/.test(translated.replace(/__PYARENA_KEEP_\d+__/g, (v) => chunks.some((x) => x.token === v) ? '' : v))) {
    throw new Error('Модель створила невідомий маркер');
  }
  let result = translated;
  for (const { token, original } of chunks) result = result.replace(token, original);
  return result;
}

const responseFormat = {
  type: 'object',
  properties: { translation: { type: 'string' } },
  required: ['translation'],
  additionalProperties: false,
};
let translatedCount = 0;
async function translate(original, context) {
  if (typeof original !== 'string' || !original.trim()) return original;
  const { masked, chunks } = maskText(original);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = `Переклади наведений текст українською мовою для школярів 8–11 класів.
Це навчальний матеріал із Python. Контекст: ${context}.
Вимоги:
- Переклад точний, доброзичливий та доступний. Не скорочуй пояснення і не додавай вигаданих фактів.
- Збережи Markdown: заголовки, списки, жирний текст, посилання, порожні рядки.
- Послідовність токенів __PYARENA_KEEP_0000__ тощо, якщо вони є, має бути абсолютно незмінною. Кожен токен відтворити рівно один раз. Не додавай лапки навколо токенів.
- Не перекладай назви Python-функцій, змінних, винятків, числові та текстові літерали в коді.
- Якщо у тексті є вимога надрукувати точний англійський рядок, не перекладай цей рядок. Збережи конкретний результат вправи.
- Терміни Python за потреби подавай як українською, так і англійською.
- Не перетворюй умову вправи на готове рішення.
- Поверни лише JSON за заданою схемою.

Текст для перекладу:\n${masked}`;
    const resp = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, format: responseFormat,
        messages: [
          { role: 'system', content: 'Ти перекладач навчальних матеріалів із програмування. Дотримуйся структури, зберігай усі маркери й точні результати.' },
          { role: 'user', content: prompt },
        ],
        options: { temperature: 0, num_ctx: 16384 },
      }),
      signal: AbortSignal.timeout(240000),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
    const result = await resp.json();
    let parsed;
    try { parsed = JSON.parse(result.message?.content || ''); }
    catch { throw new Error(`Не вдалося розібрати JSON відповіді Ollama: ${context}`); }
    if (typeof parsed.translation !== 'string' || !parsed.translation.trim()) {
      throw new Error(`Порожній переклад: ${context}`);
    }
    try {
      const value = unmaskText(parsed.translation, chunks);
      if (original.includes('**Your turn:**') && !value.includes('**Your turn:**')) {
        throw new Error('Втрачено службовий маркер **Your turn:**');
      }
      translatedCount++;
      console.log(`  ✓ ${translatedCount} · ${context}`);
      return value;
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn(`  ↻ повторна спроба (${context}): ${err.message}`);
    }
  }
}

function preserveTopicTerms(text, stepId) {
  // Topic validation checks for English terms in the step's text or code.
  // Add a short glossary before the task, never inside the exercise itself.
  const needed = [...(termsByStep.get(stepId) ?? [])]
    .filter((term) => /[A-Za-z]/.test(term))
    .filter((term) => !text.toLowerCase().includes(term.toLowerCase()));
  if (!needed.length) return text;
  const note = `**Англійські терміни:** ${needed.map((term) => `\`${term}\``).join(', ')}.\n\n`;
  const marker = '**Your turn:**';
  return text.includes(marker) ? text.replace(marker, note + marker) : text.trimEnd() + '\n\n' + note;
}

async function translateModule(name) {
  const sourcePath = path.join(moduleDir, name);
  const targetPath = path.join(ukDir, 'modules', name);
  if (fs.existsSync(targetPath) && !forced) {
    console.log(`⏭  ${name}: переклад уже існує (для перезапису: --force)`);
    return;
  }
  const source = readYaml(sourcePath);
  if (!source || !Array.isArray(source.steps) || !source.id) throw new Error(`Невідома структура ${name}`);
  console.log(`\n▶ ${name} — ${source.steps.length} кроків`);
  const overlay = { id: source.id };
  if (source.summary) overlay.summary = await translate(source.summary, `${name} — анотація`);
  overlay.steps = [];
  for (const [i, step] of source.steps.entries()) {
    console.log(`  Крок ${i + 1}/${source.steps.length}: ${step.id}`);
    const translatedStep = {
      id: step.id,
      sourceTitle: step.title,
      title: await translate(step.title, `${name}, ${step.id} — назва`),
      text: preserveTopicTerms(await translate(step.text, `${name}, ${step.id} — теорія й завдання`), step.id),
    };
    if (Array.isArray(step.hints)) {
      translatedStep.hints = [];
      for (const [hi, hint] of step.hints.entries()) {
        translatedStep.hints.push(await translate(hint, `${step.id} — підказка ${hi + 1}`));
      }
    }
    if (Array.isArray(step.more)) {
      translatedStep.more = [];
      for (const [index, challenge] of step.more.entries()) {
        const translatedChallenge = { index };
        if (challenge.task) translatedChallenge.task = await translate(challenge.task, `${step.id}, додаткова задача ${index + 1}`);
        if (Array.isArray(challenge.hints)) {
          translatedChallenge.hints = [];
          for (const [hi, hint] of challenge.hints.entries()) {
            translatedChallenge.hints.push(await translate(hint, `${step.id}, задача ${index + 1}, підказка ${hi + 1}`));
          }
        }
        translatedStep.more.push(translatedChallenge);
      }
    }
    overlay.steps.push(translatedStep);
  }
  writeYaml(targetPath, overlay);
  console.log(`✅ Створено ${path.relative(root, targetPath)}`);
}

async function translateCourse() {
  const source = readYaml(path.join(content, 'course.yaml'));
  const output = path.join(ukDir, 'course.yaml');
  const current = fs.existsSync(output) ? readYaml(output) : {};
  const existingGroups = new Map((current.groups ?? []).map((x) => [x.id, x]));
  const existingModules = new Map((current.modules ?? []).map((x) => [x.id, x]));
  const result = { groups: [], modules: [] };
  for (const group of source.groups ?? []) {
    const old = existingGroups.get(group.id) ?? {};
    result.groups.push({
      id: group.id,
      title: old.title ?? await translate(group.title, `курс, група ${group.id}: назва`),
      ...(group.about ? { about: old.about ?? await translate(group.about, `курс, група ${group.id}: опис`) } : {}),
    });
  }
  for (const mod of source.modules ?? []) {
    const old = existingModules.get(mod.id) ?? {};
    const rec = { id: mod.id, title: old.title ?? await translate(mod.title, `курс, модуль ${mod.id}`) };
    if (Array.isArray(mod.mooc) && mod.mooc.length) {
      const prevSections = new Map((old.mooc ?? []).map((x) => [String(x.section), x]));
      rec.mooc = [];
      for (const section of mod.mooc) {
        rec.mooc.push({
          section: section.section,
          title: prevSections.get(String(section.section))?.title ?? await translate(section.title, `курс, секція ${section.section}`),
        });
      }
    }
    result.modules.push(rec);
  }
  writeYaml(output, result);
  console.log(`✅ Оновлено ${path.relative(root, output)} (наявні переклади збережено)`);
}

try {
  if (course) await translateCourse();
  if (moduleName) await translateModule(moduleName);
  if (all) {
    for (const name of names) await translateModule(name);
  }
  console.log('\nГотово. Перевір: npm run i18n:check');
  console.log('Для одного модуля: node scripts/build-content.mjs --dry --module-file 03-variables.yaml');
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  console.error('Перевір, що Ollama запущено (ollama list), або повтори команду після виправлення помилки.');
  process.exitCode = 1;
}
