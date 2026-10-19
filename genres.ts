import type { Language } from './shared.js';

interface GenreDefinition {
  en: string;
  nl: string;
  aliases?: string[];
}

const genreDefinitions: Record<number, GenreDefinition> = {
  12: { en: 'Adventure', nl: 'Avontuur' },
  14: { en: 'Fantasy', nl: 'Fantasie' },
  16: { en: 'Animation', nl: 'Animatie' },
  18: { en: 'Drama', nl: 'Drama' },
  27: { en: 'Horror', nl: 'Horror' },
  28: { en: 'Action', nl: 'Actie' },
  35: { en: 'Comedy', nl: 'Komedie' },
  36: { en: 'History', nl: 'Geschiedenis', aliases: ['Historie'] },
  37: { en: 'Western', nl: 'Western' },
  53: { en: 'Thriller', nl: 'Thriller' },
  80: { en: 'Crime', nl: 'Misdaad' },
  99: { en: 'Documentary', nl: 'Documentaire' },
  878: { en: 'Science Fiction', nl: 'Sciencefiction', aliases: ['Science Fiction'] },
  9648: { en: 'Mystery', nl: 'Mysterie' },
  10402: { en: 'Music', nl: 'Muziek' },
  10749: { en: 'Romance', nl: 'Romantiek' },
  10751: { en: 'Family', nl: 'Familie' },
  10752: { en: 'War', nl: 'Oorlog' },
  10759: { en: 'Action & Adventure', nl: 'Actie & Avontuur' },
  10762: { en: 'Kids', nl: 'Kinderen' },
  10763: { en: 'News', nl: 'Nieuws' },
  10764: { en: 'Reality', nl: 'Reality' },
  10765: { en: 'Sci-Fi & Fantasy', nl: 'Sci-Fi & Fantasie' },
  10766: { en: 'Soap', nl: 'Soap' },
  10767: { en: 'Talk', nl: 'Talkshow' },
  10768: { en: 'War & Politics', nl: 'Oorlog & Politiek' },
  10770: { en: 'TV Movie', nl: 'TV-film', aliases: ['TV Film'] }
};

function normalizeGenre(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

const genreIdByName = new Map<string, number>();
for (const [id, definition] of Object.entries(genreDefinitions)) {
  for (const name of [definition.en, definition.nl, ...(definition.aliases ?? [])]) {
    genreIdByName.set(normalizeGenre(name), Number(id));
  }
}

export function genreKey(name: string, id?: number): string {
  const knownId = id && genreDefinitions[id] ? id : genreIdByName.get(normalizeGenre(name));
  return knownId ? `tmdb:${knownId}` : `name:${normalizeGenre(name)}`;
}

export function localizeGenre(name: string, language: Language, id?: number): string {
  const knownId = id && genreDefinitions[id] ? id : genreIdByName.get(normalizeGenre(name));
  const definition = knownId ? genreDefinitions[knownId] : undefined;
  return definition?.[language] ?? name;
}
