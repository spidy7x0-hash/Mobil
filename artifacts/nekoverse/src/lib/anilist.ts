export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

export type AniListMediaType = 'ANIME' | 'MANGA';
export type AniListMediaSort =
  | 'TRENDING_DESC'
  | 'POPULARITY_DESC'
  | 'SCORE_DESC'
  | 'START_DATE_DESC'
  | 'UPDATED_AT_DESC';
export type AniListMediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

export type AniListTitle = {
  romaji: string | null;
  english: string | null;
  native: string | null;
  userPreferred: string | null;
};

export type AniListImage = {
  extraLarge: string | null;
  large: string | null;
  medium: string | null;
  color: string | null;
};

export type AniListDate = {
  year: number | null;
  month: number | null;
  day: number | null;
};

export type AniListAiringEpisode = {
  airingAt: number;
  timeUntilAiring: number;
  episode: number;
};

export type AniListCharacter = {
  role: string;
  voiceActors?: AniListVoiceActor[] | null;
  node: {
    id: number;
    name: { full: string | null };
    image: { medium: string | null } | null;
  };
};

export type AniListVoiceActor = {
  id: number;
  name: { full: string | null };
  image: { medium: string | null } | null;
};

export type AniListStudio = {
  isMain: boolean;
  node: { id: number; name: string };
};

export type AniListMedia = {
  id: number;
  idMal: number | null;
  type: AniListMediaType;
  format: string | null;
  status: string | null;
  season: AniListMediaSeason | null;
  seasonYear: number | null;
  startDate: AniListDate;
  endDate: AniListDate;
  episodes: number | null;
  duration: number | null;
  chapters: number | null;
  volumes: number | null;
  averageScore: number | null;
  meanScore: number | null;
  popularity: number | null;
  trending: number | null;
  favourites: number | null;
  genres: string[];
  synonyms: string[];
  title: AniListTitle;
  coverImage: AniListImage;
  bannerImage: string | null;
  description: string | null;
  siteUrl: string | null;
  nextAiringEpisode: AniListAiringEpisode | null;
  airingSchedule: { nodes: AniListAiringEpisode[] };
  relations?: {
    edges: Array<{
      relationType: string;
      node: AniListMedia;
    }>;
  };
  characters?: { edges: AniListCharacter[] };
  studios?: { edges: AniListStudio[] };
};

export type AniListPageInfo = {
  currentPage: number;
  lastPage: number;
  hasNextPage: boolean;
  perPage: number;
  total: number;
};

export type AniListPage = {
  pageInfo: AniListPageInfo;
  media: AniListMedia[];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export class AniListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AniListError';
  }
}

const MEDIA_FIELDS = `
  id
  idMal
  type
  format
  status
  season
  seasonYear
  startDate { year month day }
  endDate { year month day }
  episodes
  duration
  chapters
  volumes
  averageScore
  meanScore
  popularity
  trending
  favourites
  genres
  synonyms
  title { romaji english native userPreferred }
  coverImage { extraLarge large medium color }
  bannerImage
  description(asHtml: false)
  siteUrl
  nextAiringEpisode { airingAt timeUntilAiring episode }
  airingSchedule(notYetAired: true, perPage: 6) {
    nodes { airingAt timeUntilAiring episode }
  }
`;

const MEDIA_CARD_FRAGMENT = `
fragment MediaCard on Media {
  ${MEDIA_FIELDS}
}
`;

async function request<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new AniListError('AniList is unavailable right now. Check your connection and try again.');
  }

  let payload: GraphQLResponse<T>;
  try {
    payload = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw new AniListError('AniList returned an unreadable response.');
  }

  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new AniListError(payload.errors?.[0]?.message || `AniList request failed (${response.status}).`);
  }

  return payload.data;
}

const PAGE_QUERY = `
query MediaPage(
  $type: MediaType!
  $search: String
  $page: Int
  $perPage: Int
  $genre: String
  $season: MediaSeason
  $seasonYear: Int
  $sort: [MediaSort!]
) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { currentPage lastPage hasNextPage perPage total }
    media(
      type: $type
      search: $search
      genre: $genre
      season: $season
      seasonYear: $seasonYear
      sort: $sort
    ) {
      ...MediaCard
    }
  }
}
${MEDIA_CARD_FRAGMENT}
`;

const DETAILS_QUERY = `
query MediaDetails($id: Int!) {
  Media(id: $id) {
    ...MediaCard
    relations {
      edges {
        relationType
        node { ...MediaCard }
      }
    }
    characters(sort: [ROLE, RELEVANCE], perPage: 12) {
      edges {
        role
        voiceActors(language: JAPANESE) {
          id
          name { full }
          image { medium }
        }
        node {
          id
          name { full }
          image { medium }
        }
      }
    }
    studios(isMain: true) {
      edges { isMain node { id name } }
    }
  }
}
${MEDIA_CARD_FRAGMENT}
`;

const GENRES_QUERY = `
query Genres {
  GenreCollection
}
`;

export type MediaPageVariables = {
  type: AniListMediaType;
  search?: string;
  page?: number;
  perPage?: number;
  genre?: string;
  season?: AniListMediaSeason;
  seasonYear?: number;
  sort?: AniListMediaSort[];
};

export async function getMediaPage(variables: MediaPageVariables): Promise<AniListPage> {
  const result = await request<{ Page: AniListPage }>(PAGE_QUERY, {
    page: 1,
    perPage: 18,
    ...variables,
  });
  return result.Page;
}

export async function searchAnime(
  variables: Omit<MediaPageVariables, 'type'> = {},
): Promise<AniListPage> {
  return getMediaPage({ ...variables, type: 'ANIME' });
}

export async function searchManga(
  variables: Omit<MediaPageVariables, 'type'> = {},
): Promise<AniListPage> {
  return getMediaPage({ ...variables, type: 'MANGA' });
}

export async function getPopularAnime(page = 1): Promise<AniListPage> {
  return searchAnime({ page, sort: ['POPULARITY_DESC'] });
}

export async function getTrendingAnime(page = 1): Promise<AniListPage> {
  return searchAnime({ page, sort: ['TRENDING_DESC'] });
}

export async function getPopularManga(page = 1): Promise<AniListPage> {
  return searchManga({ page, sort: ['POPULARITY_DESC'] });
}

export async function getTrendingManga(page = 1): Promise<AniListPage> {
  return searchManga({ page, sort: ['TRENDING_DESC'] });
}

function getCurrentSeason(date = new Date()): { season: AniListMediaSeason; year: number } {
  const month = date.getUTCMonth() + 1;
  const season =
    month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
  return { season, year: date.getUTCFullYear() };
}

export async function getSeasonalAnime(page = 1): Promise<AniListPage> {
  const current = getCurrentSeason();
  return searchAnime({
    page,
    season: current.season,
    seasonYear: current.year,
    sort: ['POPULARITY_DESC'],
  });
}

export async function getGenres(): Promise<string[]> {
  const result = await request<{ GenreCollection: string[] }>(GENRES_QUERY);
  return result.GenreCollection;
}

export async function getMediaDetails(id: number): Promise<AniListMedia> {
  const result = await request<{ Media: AniListMedia | null }>(DETAILS_QUERY, { id });
  if (!result.Media) throw new AniListError('That title could not be found on AniList.');
  return result.Media;
}

export type RelatedMedia = {
  relationType: string;
  media: AniListMedia;
};

export type Status = 'Watching' | 'Planning' | 'Completed' | 'Paused' | 'Dropped' | 'Rewatching';
export type MediaType = 'anime' | 'manga';

export type Media = {
  id: string;
  type: MediaType;
  title: string;
  subtitle: string;
  year: string;
  score: string;
  genre: string;
  genres: string[];
  image: string;
  description: string;
  episodes: number;
  current: number;
  runtime: string;
  status: Status;
  format: string;
  anilistStatus: string;
  popularity: number;
  favourites: number;
  chapters: number;
  volumes: number;
  nextAiringEpisode: AniListAiringEpisode | null;
  airingSchedule: AniListAiringEpisode[];
  characters: AniListCharacter[];
  studios: AniListStudio[];
  related: RelatedMedia[];
};

function localStatus(status: string | null): Status {
  switch (status) {
    case 'FINISHED':
      return 'Completed';
    case 'RELEASING':
      return 'Watching';
    case 'HIATUS':
      return 'Paused';
    case 'CANCELLED':
      return 'Dropped';
    default:
      return 'Planning';
  }
}

function readableDescription(description: string | null): string {
  return description?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || 'No description is available for this title yet.';
}

export function mapMedia(media: AniListMedia): Media {
  const isAnime = media.type === 'ANIME';
  const total = isAnime ? media.episodes ?? 0 : media.chapters ?? media.volumes ?? 0;
  const related = media.relations?.edges.map((edge) => ({
    relationType: edge.relationType,
    media: edge.node,
  })) || [];

  return {
    id: String(media.id),
    type: isAnime ? 'anime' : 'manga',
    title: media.title.userPreferred || media.title.english || media.title.romaji || media.title.native || 'Untitled',
    subtitle: media.title.romaji || media.title.native || media.title.english || '',
    year: String(media.seasonYear || media.startDate.year || '—'),
    score: media.averageScore ? (media.averageScore / 20).toFixed(1) : '—',
    genre: media.genres.slice(0, 2).join(' · ') || media.format || 'Uncategorized',
    genres: media.genres,
    image: media.coverImage.extraLarge || media.coverImage.large || media.coverImage.medium || '',
    description: readableDescription(media.description),
    episodes: total,
    current: 0,
    runtime: isAnime
      ? media.duration ? `${media.duration} min` : '—'
      : media.chapters ? `${media.chapters} chapters` : '—',
    status: localStatus(media.status),
    format: media.format || '—',
    anilistStatus: media.status || 'UNKNOWN',
    popularity: media.popularity ?? 0,
    favourites: media.favourites ?? 0,
    chapters: media.chapters ?? 0,
    volumes: media.volumes ?? 0,
    nextAiringEpisode: media.nextAiringEpisode,
    airingSchedule: media.airingSchedule.nodes,
    characters: media.characters?.edges || [],
    studios: media.studios?.edges || [],
    related,
  };
}

export function mapPage(page: AniListPage): Media[] {
  return page.media.map(mapMedia);
}