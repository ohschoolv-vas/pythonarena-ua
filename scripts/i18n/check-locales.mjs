/** Validate the Ukrainian overlays without changing upstream files. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { applyLocale } from './merge-locales.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const content = path.join(root, 'content');
const uk = path.join(content, 'i18n', 'uk');
const problems = [];
let steps = 0;
let challenges = 0;
const read = (file) => YAML.parse(fs.readFileSync(file, 'utf8'));

function check(original) {
    const relative = path.relative(content, original);
    try {
        const raw = read(original);
        const result = applyLocale(original, raw, { root, locale: 'uk' });
        if (relative === 'course.yaml') {
            if (result.modules.length !== raw.modules.length) throw new Error('course module count changed');
            return;
        }
        if (result.steps.length !== raw.steps.length) throw new Error('step count changed');
        // Once a module is localized, an upstream-added step or extra challenge
        // must be reviewed instead of silently falling back to English.
        const overlay = read(path.join(uk, 'modules', path.basename(original)));
        const translated = new Map((overlay.steps ?? []).map((s) => [s.id, s]));
        if (translated.size !== raw.steps.length) throw new Error('New or missing steps: review Ukrainian translation');
        for (let i = 0; i < raw.steps.length; i++) {
            const translatedStep = translated.get(raw.steps[i].id);
            if (!translatedStep) throw new Error(`Missing Ukrainian step: ${raw.steps[i].id}`);
            if ((translatedStep.more ?? []).length !== (raw.steps[i].more ?? []).length) {
                throw new Error(`New or missing challenges at ${raw.steps[i].id}`);
            }
            if (raw.steps[i].id !== result.steps[i].id || raw.steps[i].slug !== result.steps[i].slug) {
                throw new Error('step ids/slugs changed');
            }
            for (const field of ['fill', 'seed', 'solution', 'predict', 'tests', 'require', 'forbid']) {
                if (JSON.stringify(raw.steps[i][field]) !== JSON.stringify(result.steps[i][field])) {
                    throw new Error(`unsafe change of '${field}' at ${raw.steps[i].id}`);
                }
            }
            if (JSON.stringify((raw.steps[i].more ?? []).map((m) => [m.fill, m.seed, m.solution, m.predict, m.tests, m.require, m.forbid])) !==
                JSON.stringify((result.steps[i].more ?? []).map((m) => [m.fill, m.seed, m.solution, m.predict, m.tests, m.require, m.forbid]))) {
                throw new Error(`unsafe challenge change at ${raw.steps[i].id}`);
            }
            steps++;
            challenges += 1 + (raw.steps[i].more ?? []).length;
        }
        console.log(`OK ${relative}: ${raw.steps.length} steps`);
    } catch (error) {
        problems.push(`${relative}: ${error.message}`);
    }
}

check(path.join(content, 'course.yaml'));
if (!fs.existsSync(uk)) problems.push(`Missing: ${path.relative(root, uk)}`);
else {
    const dir = path.join(uk, 'modules');
    for (const name of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((x) => /\.ya?ml$/.test(x)).sort()) {
        const original = path.join(content, 'modules', name);
        if (!fs.existsSync(original)) problems.push(`No original for translation: ${name}`);
        else check(original);
    }
}
if (problems.length) {
    console.error('\nLocale validation failed:\n' + problems.map((x) => `- ${x}`).join('\n'));
    process.exitCode = 1;
} else console.log(`Ukrainian overlays OK: ${steps} steps, ${challenges} challenges; untranslated content uses English fallback.`);
