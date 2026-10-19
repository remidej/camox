import type { LocaleView } from "@/lib/locale-path";

const localeNames = new Intl.DisplayNames(["en"], { type: "language" });

/** A locale's name as the studio shows it, "German (de)", or its tag alone when unnamed. */
export function localeLabel(tag: string): string {
  try {
    const name = localeNames.of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

/** The BCP 47 tags the studio offers to add: widely used languages and their main regions. */
const OFFERED_TAGS = [
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "de-AT",
  "de-CH",
  "el",
  "en",
  "en-AU",
  "en-CA",
  "en-GB",
  "en-IE",
  "en-IN",
  "en-NZ",
  "en-US",
  "es",
  "es-419",
  "es-ES",
  "es-MX",
  "et",
  "eu",
  "fa",
  "fi",
  "fil",
  "fr",
  "fr-BE",
  "fr-CA",
  "fr-CH",
  "ga",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "nb",
  "ne",
  "nl",
  "nl-BE",
  "pa",
  "pl",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "zh-Hans",
  "zh-Hant",
  "zu",
];

export type LocaleOption = { tag: string; label: string };

/** The locales a project can add, by name: the offered tags it doesn't have yet. */
export function localeOptions(existing: readonly LocaleView[]): LocaleOption[] {
  const taken = new Set(existing.map((locale) => locale.tag.toLowerCase()));
  return OFFERED_TAGS.filter((tag) => !taken.has(tag.toLowerCase()))
    .map((tag) => ({ tag, label: localeLabel(tag) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
