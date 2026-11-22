/**
 * Ukrainian translation overlay for Python Arena.
 * Source YAML stays unchanged; only prose/labels are translated.
 * Import applyLocale() from scripts/build-content.mjs's readYaml() helper.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const COURSE_FIELDS = new Set(['title', 'about']);
const MODULE_FIELDS = new Set(['summary']);
const STEP_FIELDS = new Set(['title', 'text', 'hints']);
const CHALLENGE_FIELDS = new Set(['task', 'hints']);

function record(value, where) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${where}: expected a YAML object`);
    }
    return value;
}
function array(value, where) {
    if (!Array.isArray(value)) throw new Error(`${where}: expected a list`);
    return value;
}
function nonempty(value, where) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${where}: expected nonempty text`);
}
function translatedFields(target, source, allowed, where) {
    record(source, where);
    for (const [key, val] of Object.entries(source)) {
        if (!allowed.has(key)) throw new Error(`${where}: field '${key}' cannot be localized here`);
        if (key === 'hints') {
            array(val, `${where}.hints`).forEach((v, i) => nonempty(v, `${where}.hints[${i}]`));
        } else nonempty(val, `${where}.${key}`);
        target[key] = val;
    }
}

function overlayCourse(base, patch) {
    record(base, 'course');
    const allowed = new Set(['groups', 'modules']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`course: unexpected key '${key}'`);
    const groups = new Map((base.groups ?? []).map((g) => [g.id, g]));
    for (const g of patch.groups ?? []) {
        record(g, 'course.groups[]');
        if (!groups.has(g.id)) throw new Error(`course: unknown group id '${g.id}'`);
        const { id, ...fields } = g;
        translatedFields(groups.get(id), fields, COURSE_FIELDS, `group '${id}'`);
    }
    const modules = new Map(base.modules.map((m) => [m.id, m]));
    for (const m of patch.modules ?? []) {
        record(m, 'course.modules[]');
        if (!modules.has(m.id)) throw new Error(`course: unknown module id '${m.id}'`);
        for (const key of Object.keys(m)) if (!['id', 'title', 'mooc'].includes(key)) throw new Error(`course module '${m.id}': cannot override '${key}'`);
        const target = modules.get(m.id);
        if ('title' in m) translatedFields(target, { title: m.title }, new Set(['title']), `course module '${m.id}'`);
        if (m.mooc != null) {
            const sections = new Map((target.mooc ?? []).map((x) => [x.section, x]));
            for (const sec of array(m.mooc, `course module '${m.id}'.mooc`)) {
                record(sec, `course module '${m.id}'.mooc[]`);
                if (!sections.has(sec.section)) throw new Error(`course module '${m.id}': unknown section '${sec.section}'`);
                if (Object.keys(sec).some((k) => !['section', 'title'].includes(k))) throw new Error(`course module '${m.id}': only mooc.section and mooc.title are allowed`);
                translatedFields(sections.get(sec.section), { title: sec.title }, new Set(['title']), `mooc '${sec.section}'`);
            }
        }
    }
    return base;
}

function overlayModule(base, patch, file) {
    record(base, file);
    record(patch, file);
    if (patch.id !== base.id) throw new Error(`${file}: module id does not match upstream ('${base.id}')`);
    for (const key of Object.keys(patch)) if (!['id', 'summary', 'steps'].includes(key)) throw new Error(`${file}: cannot override '${key}'`);
    if (patch.summary != null) translatedFields(base, { summary: patch.summary }, MODULE_FIELDS, file);
    const steps = new Map(array(base.steps, `${file}.steps`).map((s) => [s.id, s]));
    for (const t of patch.steps ?? []) {
        record(t, `${file}.steps[]`);
        if (!steps.has(t.id)) throw new Error(`${file}: unknown step id '${t.id}'`);
        const original = steps.get(t.id);
        if (t.sourceTitle != null && t.sourceTitle !== original.title) {
            throw new Error(`${file}, step ${t.id}: upstream title changed. Review this translation`);
        }
        for (const key of Object.keys(t)) if (!['id', 'sourceTitle', 'title', 'text', 'hints', 'more'].includes(key)) {
            throw new Error(`${file}, step ${t.id}: cannot override '${key}'`);
        }
        const { id, sourceTitle, more, ...fields } = t;
        translatedFields(original, fields, STEP_FIELDS, `${file}, step ${id}`);
        for (const exercise of more ?? []) {
            record(exercise, `${file}, step ${id}.more[]`);
            const { index, ...changes } = exercise;
            if (!Number.isInteger(index) || index < 0 || index >= (original.more ?? []).length) {
                throw new Error(`${file}, step ${id}: invalid more index '${index}'`);
            }
            translatedFields(original.more[index], changes, CHALLENGE_FIELDS, `${file}, step ${id}, more ${index}`);
        }
    }
    return base;
}

/**
 * @param {string} filePath Original YAML absolute path.
 * @param {any} data Parsed original YAML object.
 * @param {{root:string,locale?:string}} config Repo root and target language.
 * @returns {any} New object with safe translation-only changes.
 */
export function applyLocale(filePath, data, { root, locale = 'uk' } = {}) {
    if (data == null || locale === 'en') return data;
    if (locale !== 'uk') throw new Error(`Unsupported locale: ${locale}`);
    if (!root) throw new Error('applyLocale(): missing root');
    const contentRoot = path.join(root, 'content');
    const relative = path.relative(contentRoot, filePath).replaceAll(path.sep, '/');
    if (relative !== 'course.yaml' && !/^modules\/[^/]+\.ya?ml$/.test(relative)) return data;
    const file = path.join(contentRoot, 'i18n', locale, relative);
    if (!fs.existsSync(file)) return data; // Untranslated modules fall back to English.
    const patch = YAML.parse(fs.readFileSync(file, 'utf8'));
    const copy = structuredClone(data);
    return relative === 'course.yaml' ? overlayCourse(copy, record(patch, file)) : overlayModule(copy, patch, file);
}
