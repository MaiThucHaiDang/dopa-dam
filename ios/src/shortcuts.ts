// Links that hand control back to the iPhone Shortcuts app (the shortcuts "DopaDam Vào" and "DopaDam Thoát").

export const ENTER_SHORTCUT = "DopaDam Vào";
export const EXIT_SHORTCUT = "DopaDam Thoát";

/**
 * Runs "DopaDam Vào" with the text "<app>|<minutes>" as input. The app name is passed exactly as the page got it
 * (the shortcut compares it with the name its gate uses); the shortcut should split at the LAST "|".
 */
export function enterLink(app: string, minutes: number): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(ENTER_SHORTCUT)}&input=text&text=${encodeURIComponent(`${app}|${minutes}`)}`;
}

/** Runs "DopaDam Thoát" (it sends the user to the Home Screen). */
export function exitLink(): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(EXIT_SHORTCUT)}`;
}
