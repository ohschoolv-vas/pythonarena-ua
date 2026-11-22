import { en, type UiTextKey } from './en';

/** UI dictionary; translate literal English UI strings in React components as you adopt it. */
export const uk = {
    language: 'Мова',
    ukrainian: 'Українська',
    english: 'Англійська',
    learn: 'Навчання',
    allModules: 'Усі модулі',
    startLearning: 'Почати навчання',
    projects: 'Проєкти',
    practice: 'Практика',
    settings: 'Налаштування',
    about: 'Про проєкт',
    playground: 'Пісочниця',
    run: 'Запустити',
    check: 'Перевірити',
    retry: 'Спробувати ще раз',
    reset: 'Скинути',
    next: 'Далі',
    previous: 'Назад',
    showHint: 'Показати підказку',
    hint: 'Підказка',
    solution: 'Розв’язок',
    output: 'Вивід',
    input: 'Ввід',
    tests: 'Тести',
    passed: 'Успішно',
    failed: 'Не пройдено',
    completed: 'Завершено',
    inProgress: 'У процесі',
    loading: 'Завантаження…',
    error: 'Помилка',
    backToModules: 'До списку модулів',
    challenge: 'Завдання',
    step: 'Крок',
    theme: 'Тема оформлення',
    darkTheme: 'Темна тема',
    lightTheme: 'Світла тема',
    savedLocally: 'Ваш прогрес зберігається в цьому браузері.',
} satisfies Record<UiTextKey, string>;

export type UiLocale = 'en' | 'uk';
export function t(key: UiTextKey, locale: UiLocale = 'uk'): string {
    return locale === 'uk' ? uk[key] : en[key];
}
