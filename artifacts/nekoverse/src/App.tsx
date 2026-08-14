import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { VideoPlayer } from '@/components/video-player';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Bell, BookOpen, Check, ChevronDown, CircleUserRound, Cloud, Download,
  Eye, Film, Filter, Globe2, Heart, Home, Info, Library, ListFilter, MessageCircle,
  MoreHorizontal, Palette, Pause, Play, Plus, RotateCcw, RotateCw, Search, Settings, SlidersHorizontal, Sparkles,
  Star, Sun, Trash2, Tv, UserRound, X, Zap,
} from 'lucide-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  getListExternalAccountsQueryKey,
  useDisconnectExternalAccount,
  useListExternalAccounts,
  type ExternalAccountConnections,
} from '@workspace/api-client-react';
import {
  getGenres,
  getMediaDetails,
  getPopularAnime,
  getPopularManga,
  getSeasonalAnime,
  getTrendingAnime,
  getTrendingManga,
  mapMedia,
  mapPage,
  searchAnime,
  searchManga,
  type AniListCharacter,
  type AniListMedia,
  type Media,
  type MediaType,
  type Status,
} from '@/lib/anilist';
type ThemeName = 'Midnight' | 'Sakura' | 'Crimson' | 'Violet' | 'Ocean' | 'Emerald' | 'AMOLED' | 'Light' | 'System Default';
type AnimationIntensity = 'Low' | 'Medium' | 'High';
type SettingPage = 'index' | 'accounts' | 'theme' | 'common' | 'anime' | 'manga' | 'player' | 'extensions' | 'downloads' | 'sync' | 'animation' | 'about';
const statusOptions: Status[] = ['Watching', 'Planning', 'Completed', 'Paused', 'Dropped', 'Rewatching'];
const themeNames: ThemeName[] = ['Midnight', 'Sakura', 'Crimson', 'Violet', 'Ocean', 'Emerald', 'AMOLED', 'Light', 'System Default'];

type AppSettings = {
  theme: ThemeName; accent: string; background: string; cardStyle: 'rounded' | 'soft' | 'square';
  radius: number; transparency: number; density: 'cozy' | 'compact'; glass: number;
  backgroundAppearance: 'aurora' | 'solid' | 'grain'; language: string; notifications: boolean;
  autoUpdate: boolean; haptic: boolean; confirmRemove: boolean; defaultHome: string;
  animeQuality: string; audio: string; subtitles: string; autoNext: boolean; skipIntro: boolean;
  skipOutro: boolean; episodeStyle: string; episodeHistory: boolean; progressBehavior: string; player: string;
  readingMode: string; direction: string; webtoon: boolean; continuous: boolean; pageSpacing: string;
  imageQuality: string; autoChapter: boolean; readingProgress: boolean; preload: boolean;
  hardware: boolean; subtitleStyle: string; subtitleSize: string; subtitleColor: string;
  playbackSpeed: string; gestures: boolean; controls: boolean; repositories: string[]; autoExtensions: boolean;
  downloadLocation: string; wifiOnly: boolean; downloadQuality: string; autoDownload: boolean;
  cloudSync: boolean; syncFrequency: string; privacy: string;
  animation: { enabled: boolean; intensity: AnimationIntensity; transitionSpeed: string; pageTransition: string;
    cardAnimation: string; cardBlur: number; backgroundBlur: boolean; backgroundBlurIntensity: number;
    glassIntensity: number; glow: boolean; glowIntensity: number; parallax: boolean; parallaxIntensity: number;
    swipeAnimation: string; reducedMotion: boolean; micro: boolean; button: boolean; libraryCards: boolean };
};

const defaultSettings: AppSettings = {
  theme: 'Midnight', accent: '#e52f68', background: '#120e12', cardStyle: 'rounded', radius: 18,
  transparency: 92, density: 'cozy', glass: 38, backgroundAppearance: 'aurora', language: 'English',
  notifications: true, autoUpdate: true, haptic: true, confirmRemove: true, defaultHome: 'Continue watching',
  animeQuality: '1080p', audio: 'Japanese', subtitles: 'English', autoNext: true, skipIntro: false,
  skipOutro: false, episodeStyle: 'Comfortable', episodeHistory: true, progressBehavior: 'Ask to resume', player: 'Neko Player',
  readingMode: 'Single page', direction: 'Right-to-left', webtoon: false, continuous: true, pageSpacing: 'Medium',
  imageQuality: 'High', autoChapter: true, readingProgress: true, preload: true, hardware: true,
  subtitleStyle: 'Modern', subtitleSize: 'Medium', subtitleColor: 'White', playbackSpeed: '1x', gestures: true,
  controls: true, repositories: ['NekoVerse Community'], autoExtensions: true, downloadLocation: 'NekoVerse / Downloads',
  wifiOnly: true, downloadQuality: '1080p', autoDownload: false, cloudSync: false, syncFrequency: 'Daily', privacy: 'Private',
  animation: { enabled: true, intensity: 'High', transitionSpeed: 'Normal', pageTransition: 'Slide + Fade', cardAnimation: 'Depth',
    cardBlur: 32, backgroundBlur: true, backgroundBlurIntensity: 24, glassIntensity: 38, glow: true, glowIntensity: 58,
    parallax: true, parallaxIntensity: 32, swipeAnimation: 'Cinematic', reducedMotion: false, micro: true, button: true, libraryCards: true },
};

type NekoState = {
  anime: Media[]; manga: Media[]; allMedia: Media[]; genres: string[];
  catalogLoading: boolean; catalogError: Error | null; refreshCatalog: () => void;
  library: Record<string, Status>; settings: AppSettings; theme: 'dark' | 'light';
  setStatus: (id: string, status: Status) => void; remove: (id: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void; updateAnimation: (patch: Partial<AppSettings['animation']>) => void;
  notify: (message: string) => void;
};
const NekoContext = createContext<NekoState | null>(null);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
    },
  },
});

function uniqueMedia(items: Media[]): Media[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(`${item.type}:${item.id}`)) return false;
    seen.add(`${item.type}:${item.id}`);
    return true;
  });
}

type CatalogState = {
  anime: Media[];
  manga: Media[];
  allMedia: Media[];
  genres: string[];
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

function useCatalog(): CatalogState {
  const popularAnime = useQuery({ queryKey: ['anilist', 'popular', 'anime'], queryFn: () => getPopularAnime() });
  const trendingAnime = useQuery({ queryKey: ['anilist', 'trending', 'anime'], queryFn: () => getTrendingAnime() });
  const seasonalAnime = useQuery({ queryKey: ['anilist', 'seasonal', 'anime'], queryFn: () => getSeasonalAnime() });
  const popularManga = useQuery({ queryKey: ['anilist', 'popular', 'manga'], queryFn: () => getPopularManga() });
  const trendingManga = useQuery({ queryKey: ['anilist', 'trending', 'manga'], queryFn: () => getTrendingManga() });
  const genreQuery = useQuery({ queryKey: ['anilist', 'genres'], queryFn: getGenres });
  const anime = uniqueMedia([
    ...(trendingAnime.data ? mapPage(trendingAnime.data) : []),
    ...(seasonalAnime.data ? mapPage(seasonalAnime.data) : []),
    ...(popularAnime.data ? mapPage(popularAnime.data) : []),
  ]);
  const manga = uniqueMedia([
    ...(trendingManga.data ? mapPage(trendingManga.data) : []),
    ...(popularManga.data ? mapPage(popularManga.data) : []),
  ]);
  const queries = [popularAnime, trendingAnime, seasonalAnime, popularManga, trendingManga, genreQuery];
  const failed = queries.find((query) => query.error);

  return {
    anime,
    manga,
    allMedia: [...anime, ...manga],
    genres: genreQuery.data || [],
    loading: queries.some((query) => query.isPending),
    error: failed?.error instanceof Error ? failed.error : null,
    refresh: () => { queries.forEach((query) => { void query.refetch(); }); },
  };
}

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const saved = localStorage.getItem(key); return saved ? { ...initial as object, ...JSON.parse(saved) } as T : initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
function useNeko() { const value = useContext(NekoContext); if (!value) throw new Error('NekoVerse context missing'); return value; }

function Poster({ item, className = '' }: { item: Media; className?: string }) {
  return <div className={`poster-shine relative overflow-hidden bg-[#30222a] ${className}`}><img src={item.image} alt={item.title} className="poster-img absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.opacity = '0'; }} /><div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/[.06]" /></div>;
}
function CharacterCard({ character }: { character: AniListCharacter }) {
  const name = character.node.name.full || 'Unknown character';
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const image = character.node.image?.medium;
  const voiceActor = character.voiceActors?.find((actor) => actor.name.full) || null;
  const voiceActorName = voiceActor?.name.full;
  return <article className="w-[204px] shrink-0 rounded-xl bg-[var(--app-surface)] p-3">
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--app-pink-soft)]">
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[var(--app-pink-text)]">{initials || '?'}</span>
        {image && <img src={image} alt={name} className="relative h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold">{name}</p>
        <p className="mt-1 text-[10px] uppercase tracking-[.08em] text-[var(--app-pink-text)]">{character.role}</p>
      </div>
    </div>
    {voiceActorName && <div className="mt-3 flex items-center gap-2 border-t border-[var(--app-line)] pt-2">
      <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-[var(--app-pink-soft)]">
        <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-[var(--app-pink-text)]">{voiceActorName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
        {voiceActor?.image?.medium && <img src={voiceActor.image.medium} alt="" className="relative h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
      </div>
      <div className="min-w-0">
        <p className="text-[9px] text-[var(--app-faint)]">Voice actor</p>
        <p className="truncate text-[10px] text-[var(--app-subtle)]">{voiceActorName}</p>
      </div>
    </div>}
  </article>;
}
function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} data-testid={`button-${label.toLowerCase().replaceAll(' ', '-')}`} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--app-text)] transition hover:bg-[var(--app-pink-soft)] hover:text-[var(--app-pink-text)]">{children}</button>;
}
function Header() {
  const [, navigate] = useLocation(); const { notify } = useNeko();
  return <header className="safe-top mx-auto flex w-full max-w-[680px] items-center justify-between px-5 pb-2 pt-4"><IconButton label="Search" onClick={() => navigate('/explore')}><Search size={20} strokeWidth={1.8} /></IconButton><Link href="/" data-testid="link-wordmark" className="font-display text-[18px] font-bold tracking-[-.04em] text-[var(--app-text)]"><span className="text-[var(--app-pink)]">Neko</span>Verse</Link><div className="flex items-center gap-1"><IconButton label="Notifications" onClick={() => notify('No new signals from your watchlist')}><Bell size={18} strokeWidth={1.8} /></IconButton><Link href="/profile" data-testid="link-header-profile" className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[11px] font-bold text-[var(--app-pink-text)]">AY</Link></div></header>;
}
function BottomNav() {
  const [location] = useLocation(); const items = [{ href: '/', label: 'Home', icon: Home }, { href: '/explore', label: 'Explore', icon: Search }, { href: '/library', label: 'Library', icon: Library }, { href: '/profile', label: 'Profile', icon: UserRound }];
  return <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[680px] items-center justify-around border-t border-[var(--app-line)] bg-[var(--app-surface)]/95 px-5 pt-2 backdrop-blur-xl"><div className="flex w-full justify-around pb-1">{items.map(({ href, label, icon: Icon }) => { const active = location === href || (href !== '/' && location.startsWith(href)); return <Link key={href} href={href} data-testid={`link-bottom-${label.toLowerCase()}`} className={`flex min-w-[58px] flex-col items-center gap-1 py-1 text-[10px] font-medium transition ${active ? 'text-[var(--app-pink)]' : 'text-[var(--app-faint)]'}`}><Icon size={19} strokeWidth={active ? 2.4 : 1.7} />{label}</Link>; })}</div></nav>;
}
function Shell({ children }: { children: ReactNode }) {
  const { settings } = useNeko(); const [location] = useLocation(); const immersive = location === '/settings' || location.startsWith('/watch/');
  const vars = themeVars(settings);
  return <div className={`app ${settings.animation.reducedMotion ? 'reduced-motion' : ''}`} style={vars}>{!immersive && <Header />}<main className={`mx-auto ${immersive && location.startsWith('/watch/') ? 'max-w-none pb-0' : `max-w-[680px] ${immersive ? 'pb-8' : 'pb-24'}`}`}>{children}</main>{!immersive && <BottomNav />}</div>;
}
function themeVars(settings: AppSettings): CSSProperties {
  const presets: Record<ThemeName, { bg: string; surface: string; surface2: string; text: string; subtle: string; faint: string; accent: string }> = {
    Midnight: { bg: '#120e12', surface: '#1c171b', surface2: '#252025', text: '#f5f1f2', subtle: '#a59aa0', faint: '#716970', accent: settings.accent },
    Sakura: { bg: '#1b1018', surface: '#2a1723', surface2: '#38202e', text: '#fff1f7', subtle: '#c49baa', faint: '#846375', accent: settings.accent },
    Crimson: { bg: '#170b0e', surface: '#271216', surface2: '#3a1a20', text: '#fff0f0', subtle: '#c49b9d', faint: '#805f63', accent: settings.accent },
    Violet: { bg: '#110e1c', surface: '#1d172e', surface2: '#2c2342', text: '#f7f2ff', subtle: '#aaa0c4', faint: '#756b8d', accent: settings.accent },
    Ocean: { bg: '#08151b', surface: '#10242c', surface2: '#18343e', text: '#effbff', subtle: '#9dbbc2', faint: '#62818a', accent: settings.accent },
    Emerald: { bg: '#091711', surface: '#12271d', surface2: '#1b3829', text: '#effff5', subtle: '#9cbaaa', faint: '#638675', accent: settings.accent },
    AMOLED: { bg: '#000000', surface: '#090909', surface2: '#161616', text: '#ffffff', subtle: '#a0a0a0', faint: '#5d5d5d', accent: settings.accent },
    Light: { bg: '#f8f3f4', surface: '#fffafb', surface2: '#f3e9eb', text: '#241e21', subtle: '#756b70', faint: '#9b8e94', accent: settings.accent },
    'System Default': { bg: '#120e12', surface: '#1c171b', surface2: '#252025', text: '#f5f1f2', subtle: '#a59aa0', faint: '#716970', accent: settings.accent },
  };
  const preset = presets[settings.theme]; const light = settings.theme === 'Light';
  return { '--app-bg': settings.backgroundAppearance === 'solid' ? settings.background : preset.bg, '--app-surface': preset.surface, '--app-surface-2': preset.surface2, '--app-text': preset.text, '--app-subtle': preset.subtle, '--app-faint': preset.faint, '--app-line': light ? 'rgba(52,32,39,.1)' : 'rgba(255,255,255,.09)', '--app-pink': preset.accent, '--app-pink-soft': `color-mix(in srgb, ${preset.accent} 20%, transparent)`, '--app-pink-text': light ? preset.accent : `color-mix(in srgb, ${preset.accent} 70%, white)`, '--app-shadow': light ? '0 16px 40px rgba(101,53,65,.12)' : '0 16px 40px rgba(0,0,0,.28)', '--app-radius': `${settings.radius}px`, '--app-transparency': `${settings.transparency / 100}`, '--app-glass': `${settings.glass / 100}` } as CSSProperties;
}

function RailTitle({ title, action }: { title: string; action?: string }) { const [, navigate] = useLocation(); return <div className="mb-3 flex items-center justify-between px-5"><h2 className="font-display text-[18px] font-bold tracking-[-.03em]">{title}</h2>{action && <button type="button" onClick={() => navigate('/explore')} className="text-[11px] font-semibold text-[var(--app-pink-text)]">{action}</button>}</div>; }
function CompactCard({ item, numbered = false }: { item: Media; numbered?: boolean }) {
  const { library, setStatus, notify } = useNeko(); const saved = Boolean(library[item.id]);
  return <article className="poster-card group relative w-[112px] shrink-0"><Link href={`/${item.type}/${item.id}`}><div className="relative"><Poster item={item} className="h-[156px] w-[112px] rounded-[var(--app-radius)]" />{numbered && <span className="absolute -left-1 -top-2 font-display text-[26px] font-bold text-white drop-shadow-lg">{item.id === 'frieren' ? '1' : '2'}</span>}</div><h3 className="mt-2 truncate text-[12px] font-semibold">{item.title}</h3><p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--app-subtle)]"><Star size={9} fill="currentColor" className="text-[#e9ad45]" /> {item.score} <span className="text-[var(--app-faint)]">·</span> {item.year}</p></Link><button type="button" aria-label={saved ? `Remove ${item.title}` : `Save ${item.title}`} onClick={() => { setStatus(item.id, saved ? 'Dropped' : 'Planning'); notify(saved ? 'Removed from your list' : 'Added to your watchlist'); }} className={`absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition ${saved ? 'bg-[var(--app-pink)] text-white' : 'bg-black/55 text-white hover:bg-[var(--app-pink)]'}`}>{saved ? <Check size={13} /> : <Plus size={14} />}</button></article>;
}
function HorizontalRail({ title, items, action }: { title: string; items: Media[]; action?: string }) { if (!items.length) return null; return <section className="enter mt-8"><RailTitle title={title} action={action} /><div className="hide-scrollbar flex gap-3 overflow-x-auto px-5 pb-1">{items.map((item) => <CompactCard key={`${item.type}-${item.id}`} item={item} />)}</div></section>; }

function PremiumCarousel() {
  const { anime, library, setStatus, notify, settings } = useNeko(); const [, navigate] = useLocation();
  const [active, setActive] = useState(0); const [drag, setDrag] = useState(0); const [dragging, setDragging] = useState(false); const startX = useRef(0); const dragged = useRef(false);
  const featured = anime.slice(0, 5); const current = featured[active];
  if (!current) return null;
  const saved = Boolean(library[current.id]);
  const go = (direction: number) => setActive((value) => (value + direction + featured.length) % featured.length);
  const pointerDown = (event: React.PointerEvent) => { startX.current = event.clientX; dragged.current = false; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); };
  const pointerMove = (event: React.PointerEvent) => { if (!dragging) return; const distance = event.clientX - startX.current; if (Math.abs(distance) > 5) dragged.current = true; setDrag(Math.max(-150, Math.min(150, distance))); };
  const pointerUp = () => { if (!dragging) return; if (drag < -58) go(1); else if (drag > 58) go(-1); setDrag(0); setDragging(false); };
  const motionOff = !settings.animation.enabled || settings.animation.reducedMotion;
  return <section className="enter px-5 pt-4"><div className="flex items-center justify-between"><div><p className="font-code text-[10px] uppercase tracking-[.15em] text-[var(--app-subtle)]">Watch today</p><p className="mt-1 text-[10px] text-[var(--app-faint)]">Swipe through your orbit</p></div><span className="text-[10px] text-[var(--app-faint)]">Saturday, 12 Oct</span></div><div className="carousel-stage relative mx-auto mt-5 h-[332px] max-w-[370px] touch-pan-y select-none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>{featured.map((item, index) => { let offset = index - active; if (offset > 2) offset -= featured.length; if (offset < -2) offset += featured.length; const side = Math.abs(offset); const factor = side === 0 ? 1 : .88; const x = offset * 122 + drag * factor; const scale = side === 0 ? 1 : .84; const opacity = side === 0 ? 1 : side === 1 ? .62 : .2; const blur = side === 0 ? 0 : Math.min(10, settings.animation.cardBlur / 10 * side); return <motion.div key={item.id} className={`carousel-card absolute left-1/2 top-3 h-[282px] w-[190px] ${side === 0 ? 'carousel-active' : ''}`} animate={{ x: x - 95, scale: scale + (side === 0 && Math.abs(drag) > 10 ? Math.min(Math.abs(drag) / 150 * .035, .035) : 0), opacity, filter: `blur(${blur}px)`, rotate: offset * (side ? 5 : 0) }} transition={motionOff ? { duration: 0 } : { type: 'spring', stiffness: 250, damping: 26, mass: .72 }} style={{ zIndex: 10 - side }} onClick={() => { if (!dragged.current && side === 0) navigate(`/anime/${item.id}`); }}><Poster item={item} className="h-full w-full rounded-[var(--app-radius)] shadow-[var(--app-shadow)]" />{side === 0 && <button type="button" aria-label="Play featured anime" onClick={(event) => { event.stopPropagation(); setStatus(item.id, 'Watching'); notify(`Playing ${item.title}`); }} className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-pink)] text-white shadow-[0_0_24px_var(--app-pink)]"><Play size={15} fill="currentColor" /></button>}</motion.div>; })}</div><div className="text-center"><p className="font-code text-[9px] uppercase tracking-[.15em] text-[var(--app-faint)]">Featured in your orbit</p><button type="button" onClick={() => navigate(`/anime/${current.id}`)} className="mt-1 block w-full truncate font-display text-[17px] font-bold">{current.title}</button><div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-[var(--app-subtle)]"><span>{current.year}</span><span>·</span><span className="flex items-center gap-1 text-[var(--app-pink-text)]"><Star size={11} fill="currentColor" /> {current.score}</span></div><button type="button" onClick={() => { setStatus(current.id, saved ? 'Dropped' : 'Watching'); notify(saved ? 'Removed from your list' : 'Watching status saved'); }} className="mt-3 rounded-full border border-[var(--app-pink)] px-4 py-1.5 text-[11px] font-semibold text-[var(--app-pink-text)]">{saved ? 'Watching' : 'Add to watchlist'}</button><div className="mt-4 flex items-center justify-center gap-1.5">{featured.map((item, index) => <button key={item.id} type="button" aria-label={`Show ${item.title}`} onClick={() => setActive(index)} className={`h-1.5 rounded-full transition-all ${index === active ? 'w-5 bg-[var(--app-pink)]' : 'w-1.5 bg-[var(--app-faint)]'}`} />)}</div></div></section>;
}
function ContinueRail() { const { anime, library, notify } = useNeko(); const items = anime.filter((item) => library[item.id] === 'Watching'); if (!items.length) return null; return <section className="enter enter-1 mt-8"><RailTitle title="Continue watching" action="See all" /><div className="hide-scrollbar flex gap-3 overflow-x-auto px-5">{items.map((item) => <Link key={item.id} href={`/anime/${item.id}`} className="flex w-[230px] shrink-0 gap-3 rounded-[var(--app-radius)] bg-[var(--app-surface)] p-2.5"><div className="relative h-[70px] w-[50px] shrink-0"><Poster item={item} className="h-full w-full rounded-lg" /><span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 font-code text-[8px] text-white">EP {item.current}</span></div><div className="min-w-0 flex-1 pt-1"><h3 className="truncate text-[12px] font-semibold">{item.title}</h3><p className="mt-1 text-[10px] text-[var(--app-subtle)]">{item.current} of {item.episodes || '—'} episodes</p><div className="mt-3 h-1 rounded-full bg-[var(--app-surface-2)]"><div className="h-full rounded-full bg-[var(--app-pink)]" style={{ width: `${item.episodes ? Math.max(10, item.current / item.episodes * 100) : 10}%` }} /></div><button type="button" onClick={(event) => { event.preventDefault(); notify(`Resuming ${item.title}`); }} className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[var(--app-pink-text)]">Resume <Play size={10} fill="currentColor" /></button></div></Link>)}</div></section>; }
function LoadingState({ label = 'Finding stories in your orbit...' }: { label?: string }) { return <div className="px-5 pt-24 text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--app-pink-soft)] border-t-[var(--app-pink)]" /><p className="mt-4 text-[11px] text-[var(--app-subtle)]">{label}</p></div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="px-5 pt-20 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]"><Info size={22} /></div><h1 className="mt-5 font-display text-[22px] font-bold">Signal interrupted</h1><p className="mt-2 text-[12px] text-[var(--app-subtle)]">{message}</p><button type="button" onClick={onRetry} className="mt-6 rounded-full bg-[var(--app-pink)] px-5 py-2.5 text-[11px] font-semibold text-white">Try again</button></div>; }
function HomePage() { const { anime, manga, catalogLoading, catalogError, refreshCatalog } = useNeko(); if (catalogLoading && !anime.length && !manga.length) return <LoadingState />; if (catalogError && !anime.length && !manga.length) return <ErrorState message={catalogError.message} onRetry={refreshCatalog} />; return <><PremiumCarousel /><ContinueRail /><HorizontalRail title="Top rated" items={uniqueMedia([...anime.filter((item) => item.anilistStatus === 'FINISHED'), ...manga]).slice(0, 4)} action="View all" /><HorizontalRail title="Trending anime" items={anime.slice(0, 5)} /><HorizontalRail title="Trending manga" items={manga.slice(0, 5)} /><HorizontalRail title="Recently updated" items={uniqueMedia([...anime.slice(5, 9), ...manga.slice(0, 2)])} /><HorizontalRail title="Recommended for you" items={uniqueMedia([...manga.slice(2, 5), ...anime.slice(2, 5)])} /></>; }

function ExplorePage() {
  const { genres: catalogGenres } = useNeko();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | MediaType>('all');
  const [genre, setGenre] = useState('All');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => { setPage(1); }, [search, type, genre]);
  const variables = { search: search || undefined, page, perPage: 18, genre: genre === 'All' ? undefined : genre };
  const animeQuery = useQuery({
    queryKey: ['anilist', 'search', 'anime', variables],
    queryFn: () => searchAnime(variables),
    enabled: type !== 'manga',
  });
  const mangaQuery = useQuery({
    queryKey: ['anilist', 'search', 'manga', variables],
    queryFn: () => searchManga(variables),
    enabled: type !== 'anime',
  });
  const results = uniqueMedia([
    ...(animeQuery.data ? mapPage(animeQuery.data) : []),
    ...(mangaQuery.data ? mapPage(mangaQuery.data) : []),
  ]);
  const loading = animeQuery.isPending || mangaQuery.isPending;
  const error = animeQuery.error || mangaQuery.error;
  const pageInfo = type === 'anime' ? animeQuery.data?.pageInfo : type === 'manga' ? mangaQuery.data?.pageInfo : animeQuery.data?.pageInfo || mangaQuery.data?.pageInfo;
  const genres = ['All', ...catalogGenres];
  const changeType = (nextType: 'all' | MediaType) => { setType(nextType); setPage(1); };
  const clearFilters = () => { setQuery(''); setSearch(''); setGenre('All'); setPage(1); };

  return <div className="enter px-5 pt-5"><div className="flex items-end justify-between"><div><p className="font-code text-[10px] uppercase tracking-[.16em] text-[var(--app-pink-text)]">Discover stories</p><h1 className="mt-1 font-display text-[29px] font-bold tracking-[-.05em]">Explore</h1></div><button type="button" onClick={() => setGenre('All')} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-surface)] text-[var(--app-subtle)]"><Filter size={16} /></button></div><label className="mt-5 flex h-11 items-center gap-2 rounded-full bg-[var(--app-surface)] px-4"><Search size={17} className="text-[var(--app-subtle)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles..." className="w-full bg-transparent text-[12px] outline-none placeholder:text-[var(--app-faint)]" /></label><div className="mt-4 flex gap-2"><button type="button" onClick={() => changeType('all')} className={`rounded-full px-4 py-2 text-[11px] font-semibold ${type === 'all' ? 'bg-[var(--app-pink)] text-white' : 'bg-[var(--app-surface)] text-[var(--app-subtle)]'}`}>All</button><button type="button" onClick={() => changeType('anime')} className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-semibold ${type === 'anime' ? 'bg-[var(--app-pink)] text-white' : 'bg-[var(--app-surface)] text-[var(--app-subtle)]'}`}><Tv size={12} /> Anime</button><button type="button" onClick={() => changeType('manga')} className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-semibold ${type === 'manga' ? 'bg-[var(--app-pink)] text-white' : 'bg-[var(--app-surface)] text-[var(--app-subtle)]'}`}><BookOpen size={12} /> Manga</button></div><div className="hide-scrollbar mt-4 flex gap-2 overflow-x-auto">{genres.map((item) => <button type="button" key={item} onClick={() => setGenre(item)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] ${genre === item ? 'border-[var(--app-pink)] text-[var(--app-pink-text)]' : 'border-[var(--app-line)] text-[var(--app-subtle)]'}`}>{item}</button>)}</div>{loading && !results.length ? <LoadingState label="Searching AniList..." /> : error && !results.length ? <ErrorState message={(error as Error).message} onRetry={() => { void animeQuery.refetch(); void mangaQuery.refetch(); }} /> : <><p className="mt-7 font-code text-[9px] uppercase tracking-[.15em] text-[var(--app-faint)]">{pageInfo?.total || results.length} titles in orbit</p><div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-7 sm:grid-cols-4">{results.map((item) => <CompactCard key={`${item.type}-${item.id}`} item={item} />)}</div>{!results.length && <Empty title="No titles found" copy="Try another title or clear the genre filter." action="Clear search" onClick={clearFilters} />}{pageInfo && (pageInfo.currentPage > 1 || pageInfo.hasNextPage) && <div className="mt-8 flex items-center justify-between"><button type="button" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-full bg-[var(--app-surface)] px-4 py-2 text-[10px] font-semibold disabled:opacity-40">Previous</button><span className="font-code text-[9px] text-[var(--app-faint)]">Page {pageInfo.currentPage} of {pageInfo.lastPage}</span><button type="button" disabled={!pageInfo.hasNextPage} onClick={() => { setPage((value) => value + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-full bg-[var(--app-pink)] px-4 py-2 text-[10px] font-semibold text-white disabled:opacity-40">Next</button></div>}</>}</div>;
}
function Empty({ title, copy, action, onClick }: { title: string; copy: string; action: string; onClick: () => void }) { return <div className="mt-14 rounded-2xl border border-dashed border-[var(--app-line)] px-6 py-12 text-center"><Info size={22} className="mx-auto text-[var(--app-pink-text)]" /><h2 className="mt-4 font-display text-[20px] font-bold">{title}</h2><p className="mt-2 text-[12px] text-[var(--app-subtle)]">{copy}</p><button type="button" onClick={onClick} className="mt-5 rounded-full bg-[var(--app-pink)] px-4 py-2 text-[11px] font-semibold text-white">{action}</button></div>; }
function LibraryPage() { const { allMedia, library, setStatus, remove, notify, catalogLoading } = useNeko(); const [type, setType] = useState<MediaType>('anime'); const [active, setActive] = useState<Status>('Watching'); const [query, setQuery] = useState(''); const items = allMedia.filter((item) => item.type === type && library[item.id] === active && item.title.toLowerCase().includes(query.toLowerCase())); return <div className="enter px-5 pt-5"><div className="flex items-end justify-between"><div><p className="font-code text-[10px] uppercase tracking-[.16em] text-[var(--app-pink-text)]">Your collection</p><h1 className="mt-1 font-display text-[29px] font-bold tracking-[-.05em]">Watchlist</h1></div><button type="button" onClick={() => notify('Library preferences are up to date')} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-surface)] text-[var(--app-subtle)]"><SlidersHorizontal size={16} /></button></div><div className="mt-5 flex rounded-xl bg-[var(--app-surface)] p-1"><button type="button" onClick={() => setType('anime')} className={`flex-1 rounded-lg py-2 text-[11px] font-semibold ${type === 'anime' ? 'bg-[var(--app-pink)] text-white' : 'text-[var(--app-subtle)]'}`}>Anime</button><button type="button" onClick={() => setType('manga')} className={`flex-1 rounded-lg py-2 text-[11px] font-semibold ${type === 'manga' ? 'bg-[var(--app-pink)] text-white' : 'text-[var(--app-subtle)]'}`}>Manga</button></div><label className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-[var(--app-surface)] px-3"><Search size={15} className="text-[var(--app-subtle)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your list..." className="w-full bg-transparent text-[11px] outline-none placeholder:text-[var(--app-faint)]" /></label><div className="hide-scrollbar mt-4 flex gap-2 overflow-x-auto">{statusOptions.map((status) => <button type="button" key={status} onClick={() => setActive(status)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-semibold ${active === status ? 'bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]' : 'bg-[var(--app-surface)] text-[var(--app-subtle)]'}`}>{status}</button>)}</div><div className="mt-6 space-y-2">{catalogLoading && !allMedia.length ? <LoadingState label="Loading your AniList library..." /> : items.map((item) => <div key={`${item.type}-${item.id}`} className="flex items-center gap-3 rounded-xl bg-[var(--app-surface)] p-2.5"><Link href={`/${item.type}/${item.id}`}><Poster item={item} className="h-[78px] w-[56px] rounded-lg" /></Link><div className="min-w-0 flex-1"><Link href={`/${item.type}/${item.id}`} className="block truncate text-[12px] font-semibold">{item.title}</Link><p className="mt-1 text-[10px] text-[var(--app-subtle)]">{item.year} · <span className="text-[var(--app-pink-text)]">{item.score}</span></p><div className="mt-3 flex items-center gap-2"><div className="h-1 flex-1 rounded-full bg-[var(--app-surface-2)]"><div className="h-full rounded-full bg-[var(--app-pink)]" style={{ width: `${item.episodes ? item.current / item.episodes * 100 : 0}%` }} /></div><span className="font-code text-[8px] text-[var(--app-faint)]">{item.current}/{item.episodes || '—'}</span></div></div><select value={library[item.id]} onChange={(event) => { setStatus(item.id, event.target.value as Status); notify(`${item.title} moved to ${event.target.value}`); }} className="max-w-[82px] rounded-lg border border-[var(--app-line)] bg-[var(--app-surface-2)] px-1 py-2 text-[9px] outline-none"><option>Watching</option><option>Planning</option><option>Completed</option><option>Paused</option><option>Dropped</option><option>Rewatching</option></select><button type="button" onClick={() => { remove(item.id); notify('Removed from your library'); }} className="hidden p-1 text-[var(--app-faint)] hover:text-[var(--app-pink-text)] sm:block"><Trash2 size={14} /></button></div>)}{!catalogLoading && !items.length && <Empty title={`No ${active.toLowerCase()} ${type}`} copy="Save a title to start this shelf." action="Explore titles" onClick={() => { window.history.pushState({}, '', '/explore'); window.dispatchEvent(new PopStateEvent('popstate')); }} />}</div></div>; }

function DetailPage({ type }: { type: MediaType }) {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { library, setStatus, remove, notify } = useNeko();
  const [tab, setTab] = useState('General');
  const [season, setSeason] = useState(1);
  const mediaId = Number(params.id);
  const detailQuery = useQuery({
    queryKey: ['anilist', 'details', type, params.id],
    queryFn: () => getMediaDetails(mediaId),
    enabled: Number.isInteger(mediaId) && mediaId > 0,
  });
  if (detailQuery.isPending) return <LoadingState label="Loading title details..." />;
  if (detailQuery.error) return <ErrorState message={(detailQuery.error as Error).message} onRetry={() => { void detailQuery.refetch(); }} />;
  const item = detailQuery.data ? mapMedia(detailQuery.data) : null;
  if (!item || item.type !== type) return <NotFound />;
  const saved = Boolean(library[item.id]);
  const related = item.related.filter((entry) => entry.media.type === (type === 'anime' ? 'ANIME' : 'MANGA')).slice(0, 6).map((entry) => mapMedia(entry.media));
  const characters = item.characters;
  return <div className="enter px-5 pt-3"><div className="flex items-center justify-between"><button type="button" onClick={() => navigate('/explore')} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-surface)]"><ArrowLeft size={17} /></button><span className="font-display text-[13px] font-bold">Details</span><IconButton label="More details" onClick={() => notify('More title actions coming to your shelf')}><MoreHorizontal size={18} /></IconButton></div><div className="mt-5 text-center"><Poster item={item} className="mx-auto h-[270px] w-[185px] rounded-2xl shadow-[var(--app-shadow)] sm:h-[320px] sm:w-[220px]" /><p className="mt-4 font-display text-[22px] font-bold tracking-[-.04em]">{item.title}</p><p className="mt-1 text-[11px] text-[var(--app-subtle)]">{item.year} · {item.subtitle}</p><p className="mt-2 flex items-center justify-center gap-1 text-[12px] text-[var(--app-pink-text)]"><Star size={13} fill="currentColor" /> {item.score}</p></div><div className="mt-4 flex rounded-full bg-[var(--app-surface)] p-1">{['General', 'Cast', 'Comments', 'Lists'].map((name) => <button type="button" key={name} onClick={() => setTab(name)} className={`flex-1 rounded-full py-2 text-[10px] font-semibold transition ${tab === name ? 'bg-[var(--app-pink)] text-white' : 'text-[var(--app-subtle)]'}`}>{name}</button>)}</div>{tab === 'General' && <><div className="mt-3 grid grid-cols-5 gap-1 rounded-xl bg-[var(--app-surface)] p-3 text-center">{[[Film, String(item.episodes || item.chapters || 0)], [Heart, String(item.favourites)], [Eye, String(item.popularity)], [MessageCircle, String(item.airingSchedule.length)], [ListFilter, String(item.related.length)]].map(([Icon, value]) => <div key={String(value)} className="text-[var(--app-subtle)]"><Icon size={15} className="mx-auto" /><p className="mt-1 font-code text-[9px]">{value as string}</p></div>)}</div><div className="mt-3 grid grid-cols-2 gap-2">
<button type="button" onClick={() => {
  if (type === 'anime') navigate(`/watch/${item.id}/1`);
  else navigate(`/read/${item.id}/1`);
}} className="flex items-center justify-center gap-2 rounded-full bg-[var(--app-pink)] py-3 text-[11px] font-bold text-white shadow-[var(--app-shadow)]">
  {type === 'anime' ? <Play size={14} fill="currentColor" /> : <BookOpen size={14} />} {type === 'anime' ? 'Watch' : 'Read'}
</button>
<button type="button" onClick={() => {
  setStatus(item.id, saved ? library[item.id] : 'Watching');
  notify(saved ? 'Status confirmed' : `Added to ${type === 'anime' ? 'Watching' : 'Reading'}`);
 }} className="flex items-center justify-center gap-2 rounded-full border border-[var(--app-pink)] py-3 text-[11px] font-semibold text-[var(--app-pink-text)]">
  <Eye size={14} /> {saved ? library[item.id] : 'Watching'}
</button>
  </div><p className="mt-5 text-[12px] leading-6 text-[var(--app-subtle)]">{item.description}</p><div className="mt-3 flex flex-wrap gap-2">{item.genres.map((genre) => <span key={genre} className="rounded-full bg-[var(--app-pink-soft)] px-3 py-1 text-[10px] text-[var(--app-pink-text)]">{genre}</span>)}</div>{type === 'anime' && <EpisodeList item={item} season={season} setSeason={setSeason} notify={notify} />}</>}{tab === 'Cast' && <div className="mt-5">{characters.length ? <><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-[18px] font-bold">Characters</h2><span className="font-code text-[9px] text-[var(--app-faint)]">{characters.length} listed</span></div><div className="hide-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-2">{characters.map((character) => <CharacterCard key={`${character.node.id}-${character.role}`} character={character} />)}</div></> : <div className="space-y-2">{item.studios.map((studio) => <div key={studio.node.id} className="flex items-center gap-3 rounded-xl bg-[var(--app-surface)] p-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[11px] font-bold text-[var(--app-pink-text)]">{studio.node.name.slice(0, 2).toUpperCase()}</div><div><p className="text-[12px] font-semibold">{studio.node.name}</p><p className="text-[10px] text-[var(--app-subtle)]">{studio.node.name}</p></div></div>)}</div>}</div>}{tab === 'Comments' && <div className="mt-5 space-y-3">{['The quiet between the action is what stays with me.', 'A perfect late-night watch. The atmosphere is unreal.'].map((comment, index) => <div key={comment} className="rounded-xl bg-[var(--app-surface)] p-4"><div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[9px] font-bold text-[var(--app-pink-text)]">{index ? 'KM' : 'RN'}</div><span className="text-[10px] font-semibold">{index ? 'Kumi Mori' : 'Ren N.'}</span><span className="ml-auto text-[9px] text-[var(--app-faint)]">2h ago</span></div><p className="mt-3 text-[11px] leading-5 text-[var(--app-subtle)]">{comment}</p></div>)}</div>}{tab === 'Lists' && <div className="mt-5 space-y-2"><div className="rounded-xl bg-[var(--app-surface)] p-4"><p className="text-[12px] font-semibold">Stories for rainy Sundays</p><p className="mt-1 text-[10px] text-[var(--app-subtle)]">Aiko’s list · 18 titles</p><p className="mt-1 text-[10px] text-[var(--app-subtle)]">Aiko’s list · 18 titles</p></div><div className="rounded-xl bg-[var(--app-surface)] p-4"><p className="mt-1 text-[10px] text-[var(--app-subtle)]">Community list · 42 titles</p></div></div>}<section className="mt-8"><RailTitle title={`Similar ${type}`} /><div className="hide-scrollbar flex gap-3 overflow-x-auto">{related.map((entry) => <CompactCard key={`${entry.type}-${entry.id}`} item={entry} />)}</div></section><button type="button" onClick={() => { if (saved) { remove(item.id); notify('Removed from your library'); } else { setStatus(item.id, 'Planning'); notify('Saved to library'); } }} className="mt-8 w-full rounded-full bg-[var(--app-pink)] py-3 text-[11px] font-bold text-white">{saved ? 'Remove from library' : 'Save to library'}</button></div>; }
function EpisodeList({ item, season, setSeason, notify }: { item: Media; season: number; setSeason: (season: number) => void; notify: (message: string) => void }) {
  const [, navigate] = useLocation();
  const episodeCount = Math.min(item.episodes, 12);
  const episodes = Array.from({ length: episodeCount }, (_, index) => index + 1);
  const nextAiring = item.nextAiringEpisode;
  return <section className="mt-8"><div className="flex items-center justify-between"><h2 className="font-display text-[18px] font-bold">Episodes</h2><button type="button" onClick={() => notify('Episode options opened')} className="text-[var(--app-subtle)]"><MoreHorizontal size={17} /></button></div><div className="hide-scrollbar mt-3 flex gap-2 overflow-x-auto">{[1].map((number) => <button type="button" key={number} onClick={() => setSeason(number)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] ${season === number ? 'bg-[var(--app-pink)] text-white' : 'bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]'}`}>Season {number}</button>)}</div>{nextAiring && <p className="mt-4 text-[10px] text-[var(--app-pink-text)]">Next airing: Episode {nextAiring.episode} · {new Date(nextAiring.airingAt * 1000).toLocaleString()}</p>}<p className="mt-2 text-[10px] text-[var(--app-subtle)]">You are watching S{season}. Episode {item.current || '—'} · {item.episodes || 'Episode count unavailable'} total episodes</p>{episodes.length ? <div className="mt-2 divide-y divide-[var(--app-line)] rounded-xl bg-[var(--app-surface)]">{episodes.map((number) => { const airing = item.airingSchedule.find((entry) => entry.episode === number); return <button type="button" key={number} onClick={() => navigate(`/watch/${item.id}/${number}`)} className={`flex w-full items-center gap-3 p-3 text-left ${item.current === number ? 'bg-[var(--app-pink-soft)]' : ''}`}><span className="w-5 font-code text-[10px] text-[var(--app-faint)]">S{season}. {number}</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">Episode {number}</span><span className="mt-1 block text-[9px] text-[var(--app-subtle)]">{airing ? `Airs ${new Date(airing.airingAt * 1000).toLocaleString()}` : item.runtime}</span></span>{item.current === number && <Check size={14} className="text-[var(--app-pink)]" />}</button>; })}</div> : <div className="mt-3 rounded-xl bg-[var(--app-surface)] p-4 text-center text-[10px] text-[var(--app-subtle)]">AniList has not published episode data for this title.</div>}</section>;
}

function WatchPage() {
  const params = useParams<{ id: string; episode: string }>();
  const [, navigate] = useLocation();
  const { settings } = useNeko();
  const mediaId = Number(params.id);
  const detailQuery = useQuery({ queryKey: ['anilist', 'watch', params.id], queryFn: () => getMediaDetails(mediaId), enabled: Number.isInteger(mediaId) && mediaId > 0 });
  const episode = Math.max(1, Number(params.episode) || 1);
  if (detailQuery.isPending) return <LoadingState label="Loading episode metadata..." />;
  if (detailQuery.error) return <ErrorState message={(detailQuery.error as Error).message} onRetry={() => { void detailQuery.refetch(); }} />;
  const item = detailQuery.data ? mapMedia(detailQuery.data) : null;
  if (!item || item.type !== 'anime') return <NotFound />;
  return <div className="min-h-screen bg-black">
    <VideoPlayer
      item={item}
      episode={episode}
      autoNext={settings.autoNext}
      onBack={() => navigate(`/anime/${item.id}`)}
      onEpisodeChange={(nextEpisode) => {
        if (nextEpisode >= 1 && nextEpisode <= item.episodes) navigate(`/watch/${item.id}/${nextEpisode}`);
      }}
    />
    <div className="mx-auto max-w-[680px] bg-[var(--app-bg)] px-5 pb-10 pt-6">
    <div className="flex items-center justify-between">
       <div><p className="font-display text-[18px] font-bold">Episodes</p><p className="text-[10px] text-[var(--app-subtle)]">Season 1 · {item.episodes || '—'} episodes</p></div>
      <div className="flex gap-2">
        <button type="button" disabled={episode<=1} onClick={()=>navigate(`/watch/${item.id}/${episode-1}`)} className="rounded-full bg-[var(--app-surface)] px-3 py-2 text-[10px] disabled:opacity-40">Previous</button>
        <button type="button" disabled={episode>=item.episodes} onClick={()=>navigate(`/watch/${item.id}/${episode+1}`)} className="rounded-full bg-[var(--app-pink)] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-40">Next</button>
      </div>
    </div>
    <div className="mt-3 space-y-2">
       {Array.from({length: Math.min(item.episodes, 12)}, (_,i)=>i+1).map(n=><button type="button" key={n} onClick={()=>navigate(`/watch/${item.id}/${n}`)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${n===episode?'bg-[var(--app-pink-soft)] ring-1 ring-[var(--app-pink)]':'bg-[var(--app-surface)]'}`}>
        <span className="font-code text-[10px] text-[var(--app-faint)]">{String(n).padStart(2,'0')}</span><span className="flex-1 text-[11px] font-semibold">Episode {n}</span>{n===episode && <span className="text-[9px] text-[var(--app-pink-text)]">Playing</span>}
      </button>)}
     </div>{!item.episodes && <div className="rounded-xl bg-[var(--app-surface)] p-4 text-center text-[10px] text-[var(--app-subtle)]">AniList has not published episode data for this title.</div>}
    </div>
  </div>;
}

function ReaderPage() {
  const params = useParams<{ id: string; chapter: string }>();
  const [, navigate] = useLocation();
  const mediaId = Number(params.id);
  const detailQuery = useQuery({ queryKey: ['anilist', 'reader', params.id], queryFn: () => getMediaDetails(mediaId), enabled: Number.isInteger(mediaId) && mediaId > 0 });
  const chapter = Math.max(1, Number(params.chapter) || 1);
  if (detailQuery.isPending) return <LoadingState label="Loading chapter metadata..." />;
  if (detailQuery.error) return <ErrorState message={(detailQuery.error as Error).message} onRetry={() => { void detailQuery.refetch(); }} />;
  const item = detailQuery.data ? mapMedia(detailQuery.data) : null;
  if (!item || item.type !== 'manga') return <NotFound />;
  const pages = Array.from({length: 8}, (_,i) => i+1);
  const key=`nekoverse-read-${item.id}-${chapter}`;
  return <div className="min-h-screen bg-black px-0 pb-10 text-white">
    <div className="safe-top sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-black/85 px-4 pb-3 pt-3 backdrop-blur-xl">
      <button type="button" onClick={()=>navigate(`/manga/${item.id}`)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"><ArrowLeft size={17}/></button>
      <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold">{item.title}</p><p className="text-[9px] text-white/50">Chapter {chapter}</p></div>
      <button type="button" onClick={()=>navigate(`/manga/${item.id}`)} className="rounded-full bg-white/10 px-3 py-2 text-[9px]">Exit</button>
    </div>
    <div className="mx-auto max-w-[720px]">
      {pages.map((page,index)=><div key={page} className="relative flex min-h-[60vh] items-center justify-center bg-[#090909] p-3">
        <img src={item.image} alt={`${item.title} chapter ${chapter} page ${page}`} className="max-h-[90vh] w-auto max-w-full object-contain" style={{imageRendering:'auto'}} onLoad={()=>{localStorage.setItem(key,String(page));}} />
        <span className="absolute bottom-3 right-4 rounded-full bg-black/60 px-2 py-1 font-code text-[8px] text-white/50">{page}/{pages.length}</span>
      </div>)}
    </div>
    <div className="sticky bottom-0 mx-auto flex max-w-[720px] items-center justify-between bg-black/90 p-3 backdrop-blur-xl">
      <button type="button" disabled={chapter<=1} onClick={()=>navigate(`/read/${item.id}/${chapter-1}`)} className="rounded-full bg-white/10 px-4 py-2 text-[10px] disabled:opacity-40">Previous</button>
      <span className="text-[9px] text-white/50">Chapter {chapter}</span>
      <button type="button" disabled={chapter>=item.episodes} onClick={()=>navigate(`/read/${item.id}/${chapter+1}`)} className="rounded-full bg-[var(--app-pink)] px-4 py-2 text-[10px] font-semibold disabled:opacity-40">Next</button>
    </div>
  </div>;
}

function ProfilePage() { const { allMedia, library, notify, catalogLoading } = useNeko(); const completed = allMedia.filter((item) => library[item.id] === 'Completed'); const activities = allMedia.slice(0, 3).map((item, index) => index === 0 ? `Added ${item.title}` : index === 1 ? `Updated ${item.title}` : `Reviewed ${item.title}`); if (catalogLoading && !allMedia.length) return <LoadingState label="Loading your profile..." />; return <div className="enter px-5 pt-5"><section className="text-center"><div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-xl font-bold text-[var(--app-pink-text)] ring-4 ring-[var(--app-surface)]">AY</div><h1 className="mt-3 font-display text-[24px] font-bold">Aiko Yamane</h1><p className="mt-1 text-[11px] text-[var(--app-subtle)]">@aikointhestars</p><button type="button" onClick={() => notify('Profile editor opened')} className="mt-3 rounded-full border border-[var(--app-pink)] px-4 py-1.5 text-[10px] font-semibold text-[var(--app-pink-text)]">Edit profile</button></section><div className="mt-7 grid grid-cols-4 divide-x divide-[var(--app-line)] rounded-xl bg-[var(--app-surface)] p-4 text-center"><Stat value={String(Object.keys(library).length)} label="Library" /><Stat value={String(completed.length)} label="Finished" /><Stat value="—" label="Watch time" /><Stat value="—" label="Favorites" /></div><section className="mt-8"><RailTitle title="Completed titles" action="See all" /><div className="hide-scrollbar flex gap-3 overflow-x-auto">{completed.length ? completed.map((item) => <CompactCard item={item} key={`${item.type}-${item.id}`} />) : <p className="px-5 text-[11px] text-[var(--app-subtle)]">No completed titles yet.</p>}</div></section><section className="mt-8"><RailTitle title="Recent activity" /><div className="space-y-2">{activities.map((activity, index) => <div key={activity} className="flex items-center gap-3 rounded-xl bg-[var(--app-surface)] p-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]">{index === 0 ? <Check size={15} /> : index === 1 ? <Plus size={15} /> : <Heart size={15} />}</div><p className="flex-1 text-[11px]">{activity}</p><span className="text-[9px] text-[var(--app-faint)]">{index + 1}d ago</span></div>)}</div></section><Link href="/settings" className="mt-8 flex items-center gap-3 rounded-xl bg-[var(--app-surface)] p-4 text-[12px] font-semibold"><Settings size={17} className="text-[var(--app-pink-text)]" /> Account and settings <ChevronDown size={15} className="ml-auto rotate-[-90deg] text-[var(--app-subtle)]" /></Link></div>; }
function Stat({ value, label }: { value: string; label: string }) { return <div><p className="font-display text-[18px] font-bold">{value}</p><p className="mt-1 text-[9px] text-[var(--app-subtle)]">{label}</p></div>; }

function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) { return <button type="button" role="switch" aria-label={label} aria-checked={value} onClick={() => onChange(!value)} className={`relative h-6 w-10 shrink-0 rounded-full p-1 transition ${value ? 'bg-[var(--app-pink)]' : 'bg-[var(--app-surface-2)]'}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} /></button>; }
function Segment({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) { return <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--app-surface-2)] p-1">{options.map((option) => <button type="button" key={option} onClick={() => onChange(option)} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-semibold transition ${value === option ? 'bg-[var(--app-pink)] text-white' : 'text-[var(--app-subtle)]'}`}>{option}</button>)}</div>; }
function Slider({ value, min = 0, max = 100, onChange, label }: { value: number; min?: number; max?: number; onChange: (value: number) => void; label: string }) { return <div className="flex items-center gap-3"><input aria-label={label} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="accent-[var(--app-pink)]" /><span className="w-9 text-right font-code text-[9px] text-[var(--app-pink-text)]">{value}%</span></div>; }
function SettingRow({ icon: Icon, title, description, control, onClick }: { icon?: typeof Sparkles; title: string; description?: string; control?: ReactNode; onClick?: () => void }) { const body = <><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]">{Icon ? <Icon size={17} /> : <Sparkles size={17} />}</div><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{title}</p>{description && <p className="mt-1 text-[10px] leading-4 text-[var(--app-subtle)]">{description}</p>}</div>{control || <ChevronDown size={15} className="rotate-[-90deg] text-[var(--app-subtle)]" />}</>; return onClick ? <button type="button" onClick={onClick} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-[var(--app-pink-soft)]">{body}</button> : <div className="flex items-center gap-3 p-4">{body}</div>; }
function SettingsHeader({ title, page, onBack }: { title: string; page: SettingPage; onBack: () => void }) { return <div className="safe-top sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--app-line)] bg-[var(--app-bg)]/90 px-5 pb-4 pt-4 backdrop-blur-xl"><button type="button" onClick={onBack} aria-label="Back to settings" className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--app-surface)]"><ArrowLeft size={17} /></button><div><p className="font-code text-[9px] uppercase tracking-[.16em] text-[var(--app-pink-text)]">{page === 'index' ? 'Make it yours' : 'Settings'}</p><h1 className="font-display text-[23px] font-bold tracking-[-.04em]">{title}</h1></div></div>; }
const categories: { page: SettingPage; title: string; description: string; icon: typeof Sparkles }[] = [
  { page: 'accounts', title: 'Accounts', description: 'AniList, MAL and Discord', icon: CircleUserRound }, { page: 'theme', title: 'Theme', description: 'Change the vibe of your app', icon: Palette }, { page: 'common', title: 'Common', description: 'UI and general preferences', icon: SlidersHorizontal }, { page: 'anime', title: 'Anime', description: 'Watching preferences', icon: Tv }, { page: 'manga', title: 'Manga / Reading', description: 'Reading preferences', icon: BookOpen }, { page: 'player', title: 'Player', description: 'Playback preferences', icon: Play }, { page: 'extensions', title: 'Extensions', description: 'Manage repositories and extensions', icon: Zap }, { page: 'downloads', title: 'Downloads', description: 'Download preferences', icon: Download }, { page: 'animation', title: 'Animation', description: 'Control motion and visual effects', icon: Sparkles }, { page: 'sync', title: 'Data & Sync', description: 'Backup and synchronization', icon: Cloud }, { page: 'about', title: 'About', description: 'App information', icon: Info },
];
function SettingsPage() {
  const { settings, updateSettings, updateAnimation, notify } = useNeko(); const [page, setPage] = useState<SettingPage>('index');
  const queryClient = useQueryClient();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get('oauth');
    const provider = params.get('provider') as IntegrationProvider | null;
    const reason = params.get('reason');
    if (!oauth || !provider || !integrationLabels[provider]) return;

    if (oauth === 'connected') {
      notify(`${integrationLabels[provider].title} Connected`);
      void queryClient.invalidateQueries({ queryKey: getListExternalAccountsQueryKey() });
    } else {
      const messages: Record<string, string> = {
        access_denied: `${integrationLabels[provider].title} authorization was cancelled`,
        already_linked: 'That account is already linked to another NekoVerse user',
        invalid_callback: `${integrationLabels[provider].title} returned an invalid callback`,
        invalid_state: `${integrationLabels[provider].title} login expired. Please try again`,
        provider_error: `${integrationLabels[provider].title} could not complete the connection`,
        session_expired: 'Your NekoVerse session expired. Please sign in and try again',
        unsupported_provider: 'That connection provider is not supported',
      };
      notify(messages[reason || ''] || `${integrationLabels[provider].title} connection failed`);
    }

    window.history.replaceState({}, '', window.location.pathname);
  }, [notify, queryClient]);
  const goBack = () => setPage(page === 'index' ? 'index' : 'index'); const set = (patch: Partial<AppSettings>) => updateSettings(patch);
  const title = page === 'index' ? 'Settings' : categories.find((item) => item.page === page)?.title || 'Settings';
  return <div className="settings-shell enter"><SettingsHeader title={title} page={page} onBack={goBack} /><AnimatePresence mode="wait"><motion.div key={page} initial={{ opacity: 0, x: page === 'index' ? -10 : 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: settings.animation.reducedMotion ? 0 : .22 }} className="px-5 pb-10 pt-6">{page === 'index' && <SettingsIndex onOpen={setPage} settings={settings} />}{page === 'accounts' && <AccountsSettings notify={notify} />}{page === 'theme' && <ThemeSettings settings={settings} update={set} />}{page === 'common' && <CommonSettings settings={settings} update={set} />}{page === 'anime' && <AnimeSettings settings={settings} update={set} />}{page === 'manga' && <MangaSettings settings={settings} update={set} />}{page === 'player' && <PlayerSettings settings={settings} update={set} />}{page === 'extensions' && <ExtensionSettings settings={settings} update={set} notify={notify} />}{page === 'downloads' && <DownloadSettings settings={settings} update={set} />}{page === 'sync' && <SyncSettings settings={settings} update={set} notify={notify} />}{page === 'animation' && <AnimationSettings settings={settings} update={updateAnimation} />}{page === 'about' && <AboutSettings />}</motion.div></AnimatePresence></div>;
}
function SettingsIndex({ onOpen, settings }: { onOpen: (page: SettingPage) => void; settings: AppSettings }) { return <><div className="settings-intro"><p className="text-[12px] text-[var(--app-subtle)]">Tune your watch space until it feels like home.</p><div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--app-pink-soft)] p-3 text-[10px] text-[var(--app-pink-text)]"><Sparkles size={15} /> {settings.theme} theme · {settings.animation.enabled ? 'Motion enabled' : 'Motion minimized'}</div></div><div className="mt-7 space-y-2">{categories.map(({ page, title, description, icon }) => <div key={page} className="overflow-hidden rounded-[var(--app-radius)] bg-[var(--app-surface)]"><SettingRow icon={icon} title={title} description={description} onClick={() => onOpen(page)} /></div>)}</div><p className="mt-8 text-center font-code text-[9px] text-[var(--app-faint)]">NekoVerse 1.5.0 · made for after-hours</p></>; }
function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="mt-7"><p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-[var(--app-faint)]">{title}</p><div className="overflow-hidden rounded-[var(--app-radius)] bg-[var(--app-surface)] divide-y divide-[var(--app-line)]">{children}</div></section>; }
function SimpleRow({ title, description, value, onChange, options, icon }: { title: string; description?: string; value: string | boolean; onChange?: (value: string | boolean) => void; options?: string[]; icon?: typeof Sparkles }) { const clickable = typeof value === 'string' && !options && Boolean(onChange); return <SettingRow icon={icon} title={title} description={description} onClick={clickable ? () => onChange?.(value) : undefined} control={typeof value === 'boolean' ? <Toggle value={value} onChange={(next) => onChange?.(next)} label={title} /> : options ? <select aria-label={title} value={value} onChange={(event) => onChange?.(event.target.value)} className="max-w-[130px] rounded-lg bg-[var(--app-surface-2)] px-2 py-2 text-[10px] text-[var(--app-pink-text)] outline-none">{options.map((option) => <option key={option}>{option}</option>)}</select> : <span className="max-w-[120px] truncate text-right text-[10px] text-[var(--app-pink-text)]">{value}</span>} />; }
type IntegrationProvider = 'anilist' | 'myanimelist' | 'discord';

const integrationLabels: Record<IntegrationProvider, { title: string; description: string; icon: typeof Sparkles }> = {
  anilist: { title: 'AniList', description: 'Sync anime lists and scores', icon: Tv },
  myanimelist: { title: 'MyAnimeList', description: 'Keep your MAL library close', icon: Library },
  discord: { title: 'Discord', description: 'Share your current watch status', icon: MessageCircle },
};

function IntegrationRow({ connection, onConnect, onDisconnect }: {
  connection: ExternalAccountConnections['connections'][number];
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const meta = integrationLabels[connection.provider as IntegrationProvider];
  return <div className="flex items-center gap-3 p-4">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]">
      {connection.avatarUrl ? <img src={connection.avatarUrl} alt="" className="h-full w-full object-cover" /> : <meta.icon size={17} />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[12px] font-semibold">{meta.title}</p>
      <p className="mt-1 truncate text-[10px] leading-4 text-[var(--app-subtle)]">{connection.connected ? connection.username || 'Connected account' : meta.description}</p>
    </div>
    {connection.connected ? <button type="button" onClick={onDisconnect} className="shrink-0 rounded-full bg-[var(--app-surface-2)] px-3 py-2 text-[10px] font-semibold text-[var(--app-pink-text)]">Disconnect</button> : <button type="button" onClick={onConnect} className="shrink-0 rounded-full bg-[var(--app-pink)] px-3 py-2 text-[10px] font-semibold text-white">Connect</button>}
  </div>;
}

function AccountsSettings({ notify }: { notify: (message: string) => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const connectionsQuery = useListExternalAccounts({ query: { queryKey: getListExternalAccountsQueryKey(), enabled: isLoaded && Boolean(isSignedIn) } });
  const disconnectMutation = useDisconnectExternalAccount();
  const connections = connectionsQuery.data?.connections ?? [
    { provider: 'anilist' as const, connected: false, username: null, avatarUrl: null, connectedAt: null },
    { provider: 'myanimelist' as const, connected: false, username: null, avatarUrl: null, connectedAt: null },
    { provider: 'discord' as const, connected: false, username: null, avatarUrl: null, connectedAt: null },
  ];

  const start = (provider: IntegrationProvider) => {
    if (!isSignedIn) {
      navigate('/sign-in');
      return;
    }
    window.location.assign(`/api/integrations/${provider}/start`);
  };
  const disconnect = (provider: IntegrationProvider) => {
    disconnectMutation.mutate({ provider }, {
      onSuccess: () => {
        notify(`${integrationLabels[provider].title} disconnected`);
        void queryClient.invalidateQueries({ queryKey: getListExternalAccountsQueryKey() });
      },
      onError: () => notify('Could not disconnect this account'),
    });
  };

  return <><Section title="Connected services">{connections.map((connection) => <IntegrationRow key={connection.provider} connection={connection} onConnect={() => start(connection.provider as IntegrationProvider)} onDisconnect={() => disconnect(connection.provider as IntegrationProvider)} />)}</Section><Section title="Account"><SimpleRow title="Login / Logout" description={isSignedIn ? user?.primaryEmailAddress?.emailAddress || user?.username || 'Signed in' : 'Connect your NekoVerse identity first'} value={isSignedIn ? 'Sign out' : 'Sign in'} onChange={() => { if (isSignedIn) void signOut({ redirectUrl: import.meta.env.BASE_URL || '/' }); else navigate('/sign-in'); }} icon={CircleUserRound} /><SimpleRow title="Account management" value={isSignedIn ? 'Open' : 'Sign in required'} onChange={() => notify('Account management is handled by your NekoVerse sign-in')} /><SimpleRow title="Sync settings" value="Configure" onChange={() => notify('Choose a connected service to sync')} /></Section></>;
}
function ThemeSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void }) { const accents = ['#e52f68', '#ff718d', '#a66cff', '#4db9ff', '#54d99b', '#f1ad4e']; return <><Section title="Atmosphere"><div className="grid grid-cols-3 gap-2 p-3">{themeNames.map((theme) => <button key={theme} type="button" onClick={() => update({ theme })} className={`theme-preview theme-${theme.toLowerCase().replaceAll(' ', '-')} ${settings.theme === theme ? 'selected' : ''}`}><div className="h-9 rounded-lg" /><span>{theme}</span></button>)}</div></Section><Section title="Accent color"><div className="p-4"><div className="flex flex-wrap gap-2">{accents.map((accent) => <button key={accent} type="button" aria-label={`Accent ${accent}`} onClick={() => update({ accent })} className={`h-8 w-8 rounded-full border-2 ${settings.accent === accent ? 'border-white ring-2 ring-[var(--app-pink)]' : 'border-transparent'}`} style={{ background: accent }} />)}<label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[var(--app-line)] text-[var(--app-subtle)]"><Palette size={13} /><input type="color" value={settings.accent} onChange={(event) => update({ accent: event.target.value })} className="sr-only" /></label></div><div className="mt-4 flex items-center justify-between text-[10px] text-[var(--app-subtle)]"><span>Custom accent</span><input type="color" aria-label="Custom accent color" value={settings.accent} onChange={(event) => update({ accent: event.target.value })} /></div></div></Section><Section title="Surface"><SimpleRow title="Background color" value={settings.background} onChange={(value) => update({ background: String(value) })} icon={Palette} /><SimpleRow title="Card style" value={settings.cardStyle} options={['rounded', 'soft', 'square']} onChange={(value) => update({ cardStyle: String(value) as AppSettings['cardStyle'] })} /><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Corner radius</span><span className="text-[var(--app-pink-text)]">{settings.radius}px</span></div><Slider value={settings.radius} min={4} max={28} onChange={(value) => update({ radius: value })} label="Corner radius" /></div><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>UI transparency</span><span className="text-[var(--app-pink-text)]">{settings.transparency}%</span></div><Slider value={settings.transparency} onChange={(value) => update({ transparency: value })} label="UI transparency" /></div><SimpleRow title="UI density" value={settings.density} options={['cozy', 'compact']} onChange={(value) => update({ density: String(value) as AppSettings['density'] })} /><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Glass effect</span><span className="text-[var(--app-pink-text)]">{settings.glass}%</span></div><Slider value={settings.glass} onChange={(value) => update({ glass: value })} label="Glass effect" /></div><SimpleRow title="Background appearance" value={settings.backgroundAppearance} options={['aurora', 'solid', 'grain']} onChange={(value) => update({ backgroundAppearance: String(value) as AppSettings['backgroundAppearance'] })} /></Section></>; }
function CommonSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void }) { return <Section title="Common"><SimpleRow title="Language" value={settings.language} options={['English', 'Japanese', 'Korean', 'Spanish']} onChange={(value) => update({ language: String(value) })} icon={Globe2} /><SimpleRow title="Notifications" description="New episodes and list activity" value={settings.notifications} onChange={(value) => update({ notifications: Boolean(value) })} /><SimpleRow title="Auto update" value={settings.autoUpdate} onChange={(value) => update({ autoUpdate: Boolean(value) })} /><SimpleRow title="Haptic feedback" value={settings.haptic} onChange={(value) => update({ haptic: Boolean(value) })} /><SimpleRow title="Confirm before removing" value={settings.confirmRemove} onChange={(value) => update({ confirmRemove: Boolean(value) })} /><SimpleRow title="Default home section" value={settings.defaultHome} options={['Continue watching', 'Top rated', 'Trending anime']} onChange={(value) => update({ defaultHome: String(value) })} /><SimpleRow title="Privacy settings" value={settings.privacy} options={['Private', 'Friends only', 'Public']} onChange={(value) => update({ privacy: String(value) })} /></Section>; }
function AnimeSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void }) { return <Section title="Anime"><SimpleRow title="Default playback quality" value={settings.animeQuality} options={['Auto', '1080p', '720p', '480p']} onChange={(value) => update({ animeQuality: String(value) })} icon={Tv} /><SimpleRow title="Default audio language" value={settings.audio} options={['Japanese', 'English', 'Korean']} onChange={(value) => update({ audio: String(value) })} /><SimpleRow title="Subtitle language" value={settings.subtitles} options={['English', 'Spanish', 'French', 'Off']} onChange={(value) => update({ subtitles: String(value) })} /><SimpleRow title="Auto play next episode" value={settings.autoNext} onChange={(value) => update({ autoNext: Boolean(value) })} /><SimpleRow title="Skip intro" value={settings.skipIntro} onChange={(value) => update({ skipIntro: Boolean(value) })} /><SimpleRow title="Skip outro" value={settings.skipOutro} onChange={(value) => update({ skipOutro: Boolean(value) })} /><SimpleRow title="Episode display style" value={settings.episodeStyle} options={['Comfortable', 'Compact', 'Minimal']} onChange={(value) => update({ episodeStyle: String(value) })} /><SimpleRow title="Episode history" value={settings.episodeHistory} onChange={(value) => update({ episodeHistory: Boolean(value) })} /><SimpleRow title="Watch progress behavior" value={settings.progressBehavior} options={['Ask to resume', 'Always resume', 'Start over']} onChange={(value) => update({ progressBehavior: String(value) })} /><SimpleRow title="Default player" value={settings.player} options={['Neko Player', 'System player']} onChange={(value) => update({ player: String(value) })} /></Section>; }
function MangaSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void }) { return <Section title="Manga / Reading"><SimpleRow title="Reading mode" value={settings.readingMode} options={['Single page', 'Double page', 'Webtoon']} onChange={(value) => update({ readingMode: String(value) })} icon={BookOpen} /><SimpleRow title="Page direction" value={settings.direction} options={['Left-to-right', 'Right-to-left']} onChange={(value) => update({ direction: String(value) })} /><SimpleRow title="Webtoon mode" value={settings.webtoon} onChange={(value) => update({ webtoon: Boolean(value) })} /><SimpleRow title="Continuous scrolling" value={settings.continuous} onChange={(value) => update({ continuous: Boolean(value) })} /><SimpleRow title="Page spacing" value={settings.pageSpacing} options={['Small', 'Medium', 'Large']} onChange={(value) => update({ pageSpacing: String(value) })} /><SimpleRow title="Image quality" value={settings.imageQuality} options={['Auto', 'High', 'Original']} onChange={(value) => update({ imageQuality: String(value) })} /><SimpleRow title="Auto next chapter" value={settings.autoChapter} onChange={(value) => update({ autoChapter: Boolean(value) })} /><SimpleRow title="Reading progress" value={settings.readingProgress} onChange={(value) => update({ readingProgress: Boolean(value) })} /><SimpleRow title="Preload pages" value={settings.preload} onChange={(value) => update({ preload: Boolean(value) })} /></Section>; }
function PlayerSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void }) { return <Section title="Player"><SimpleRow title="Default player" value={settings.player} options={['Neko Player', 'System player']} onChange={(value) => update({ player: String(value) })} icon={Play} /><SimpleRow title="Auto play" value={settings.autoNext} onChange={(value) => update({ autoNext: Boolean(value) })} /><SimpleRow title="Hardware acceleration" value={settings.hardware} onChange={(value) => update({ hardware: Boolean(value) })} /><SimpleRow title="Subtitle style" value={settings.subtitleStyle} options={['Modern', 'Classic', 'Minimal']} onChange={(value) => update({ subtitleStyle: String(value) })} /><SimpleRow title="Subtitle size" value={settings.subtitleSize} options={['Small', 'Medium', 'Large']} onChange={(value) => update({ subtitleSize: String(value) })} /><SimpleRow title="Subtitle color" value={settings.subtitleColor} options={['White', 'Yellow', 'Pink']} onChange={(value) => update({ subtitleColor: String(value) })} /><SimpleRow title="Playback speed" value={settings.playbackSpeed} options={['0.75x', '1x', '1.25x', '1.5x', '2x']} onChange={(value) => update({ playbackSpeed: String(value) })} /><SimpleRow title="Skip intro" value={settings.skipIntro} onChange={(value) => update({ skipIntro: Boolean(value) })} /><SimpleRow title="Skip outro" value={settings.skipOutro} onChange={(value) => update({ skipOutro: Boolean(value) })} /><SimpleRow title="Player gestures" value={settings.gestures} onChange={(value) => update({ gestures: Boolean(value) })} /><SimpleRow title="Player controls" value={settings.controls} onChange={(value) => update({ controls: Boolean(value) })} /></Section>; }
function ExtensionSettings({ settings, update, notify }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void; notify: (message: string) => void }) { const [repo, setRepo] = useState(''); return <><Section title="Repositories"><SimpleRow title="Repository status" description={`${settings.repositories.length} sources available`} value="Healthy" onChange={() => notify('All repositories are healthy')} icon={Globe2} /><div className="p-4"><div className="flex gap-2"><input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="Repository URL or name" className="min-w-0 flex-1 rounded-lg bg-[var(--app-surface-2)] px-3 py-2 text-[10px] outline-none" /><button type="button" onClick={() => { if (repo.trim()) { update({ repositories: [...settings.repositories, repo.trim()] }); setRepo(''); notify('Repository added'); } }} className="rounded-lg bg-[var(--app-pink)] px-3 text-[10px] font-bold text-white">Add</button></div></div>{settings.repositories.map((repository) => <div key={repository} className="flex items-center gap-3 p-4"><Globe2 size={16} className="text-[var(--app-pink-text)]" /><span className="flex-1 text-[11px]">{repository}</span><button type="button" onClick={() => update({ repositories: settings.repositories.filter((item) => item !== repository) })} className="text-[10px] text-[var(--app-pink-text)]">Remove</button></div>)}</Section><Section title="Installed extensions"><SimpleRow title="Neko Catalog" description="Anime metadata and artwork" value={settings.autoExtensions} onChange={(value) => update({ autoExtensions: Boolean(value) })} icon={Zap} /><SimpleRow title="Update extensions" value="Check now" onChange={() => notify('Extensions are up to date')} /><SimpleRow title="Extension source management" value="Manage" onChange={() => notify('Extension source manager opened')} /></Section></>; }
function DownloadSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void }) { return <Section title="Downloads"><SimpleRow title="Download location" value={settings.downloadLocation} options={['NekoVerse / Downloads', 'Device storage']} onChange={(value) => update({ downloadLocation: String(value) })} icon={Download} /><SimpleRow title="Wi-Fi only" value={settings.wifiOnly} onChange={(value) => update({ wifiOnly: Boolean(value) })} /><SimpleRow title="Download quality" value={settings.downloadQuality} options={['1080p', '720p', '480p']} onChange={(value) => update({ downloadQuality: String(value) })} /><SimpleRow title="Auto download" value={settings.autoDownload} onChange={(value) => update({ autoDownload: Boolean(value) })} /><SimpleRow title="Storage information" value="2.4 GB free" /><SimpleRow title="Download queue" value="Empty" /><SimpleRow title="Download management" value="Open" /></Section>; }
function SyncSettings({ settings, update, notify }: { settings: AppSettings; update: (patch: Partial<AppSettings>) => void; notify: (message: string) => void }) { return <><Section title="Data & Sync"><SimpleRow title="Cloud sync" description="Prototype sync is stored locally" value={settings.cloudSync} onChange={(value) => update({ cloudSync: Boolean(value) })} icon={Cloud} /><SimpleRow title="Sync frequency" value={settings.syncFrequency} options={['Manual', 'Daily', 'Weekly']} onChange={(value) => update({ syncFrequency: String(value) })} /><SimpleRow title="Backup library" value="Create backup" onChange={() => notify('Library backup created locally')} /><SimpleRow title="Restore library" value="Choose file" onChange={() => notify('Restore flow opened')} /><SimpleRow title="Import data" value="Import" onChange={() => notify('Import flow opened')} /><SimpleRow title="Export data" value="Export" onChange={() => notify('Library exported locally')} /><SimpleRow title="Clear cache" value="Clear" onChange={() => notify('Local cache cleared')} /><SimpleRow title="Reset local data" value="Reset" onChange={() => notify('Reset is protected in this prototype')} /></Section></>; }

function AnimationSettings({ settings, update }: { settings: AppSettings; update: (patch: Partial<AppSettings['animation']>) => void }) { const { anime } = useNeko(); const animation = settings.animation; const previewStyle = { '--preview-blur': `${animation.cardBlur / 12}px`, '--preview-glow': animation.glow ? `0 0 ${animation.glowIntensity / 2}px var(--app-pink)` : 'none', '--preview-shift': `${animation.parallaxIntensity / 8}px` } as CSSProperties; return <><div className="animation-preview" style={previewStyle}><div className="flex items-center justify-between"><div><p className="font-code text-[9px] uppercase tracking-[.15em] text-[var(--app-pink-text)]">Live preview</p><p className="mt-1 text-[11px] text-[var(--app-subtle)]">Tune the feeling of motion</p></div><Sparkles size={17} className="text-[var(--app-pink-text)]" /><div className="preview-orbit">{anime.slice(1, 4).map((item) => <img key={item.id} src={item.image} alt="" />)}</div></div></div><Section title="Motion"><SimpleRow title="Master animations" value={animation.enabled} onChange={(value) => update({ enabled: Boolean(value) })} icon={Sparkles} /><SimpleRow title="Animation intensity" value={animation.intensity} options={['Low', 'Medium', 'High']} onChange={(value) => update({ intensity: String(value) as AnimationIntensity })} /><SimpleRow title="Transition speed" value={animation.transitionSpeed} options={['Slow', 'Normal', 'Fast']} onChange={(value) => update({ transitionSpeed: String(value) })} /><SimpleRow title="Page transitions" value={animation.pageTransition} options={['Slide', 'Fade', 'Scale', 'Slide + Fade']} onChange={(value) => update({ pageTransition: String(value) })} /><SimpleRow title="Card animation" value={animation.cardAnimation} options={['Scale', 'Slide', 'Depth', 'Parallax']} onChange={(value) => update({ cardAnimation: String(value) })} /><SimpleRow title="Swipe animation" value={animation.swipeAnimation} options={['Smooth', 'Dynamic', 'Cinematic']} onChange={(value) => update({ swipeAnimation: String(value) })} /></Section><Section title="Depth & effects"><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Card blur</span><span className="text-[var(--app-pink-text)]">{animation.cardBlur}%</span></div><Slider value={animation.cardBlur} onChange={(value) => update({ cardBlur: value })} label="Card blur" /></div><SimpleRow title="Background blur" value={animation.backgroundBlur} onChange={(value) => update({ backgroundBlur: Boolean(value) })} /><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Background blur intensity</span><span className="text-[var(--app-pink-text)]">{animation.backgroundBlurIntensity}%</span></div><Slider value={animation.backgroundBlurIntensity} onChange={(value) => update({ backgroundBlurIntensity: value })} label="Background blur intensity" /></div><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Glass effect</span><span className="text-[var(--app-pink-text)]">{animation.glassIntensity}%</span></div><Slider value={animation.glassIntensity} onChange={(value) => update({ glassIntensity: value })} label="Glass effect intensity" /></div><SimpleRow title="Glow" value={animation.glow} onChange={(value) => update({ glow: Boolean(value) })} /><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Glow intensity</span><span className="text-[var(--app-pink-text)]">{animation.glowIntensity}%</span></div><Slider value={animation.glowIntensity} onChange={(value) => update({ glowIntensity: value })} label="Glow intensity" /></div><SimpleRow title="Parallax" value={animation.parallax} onChange={(value) => update({ parallax: Boolean(value) })} /><div className="p-4"><div className="mb-2 flex justify-between text-[10px]"><span>Parallax intensity</span><span className="text-[var(--app-pink-text)]">{animation.parallaxIntensity}%</span></div><Slider value={animation.parallaxIntensity} onChange={(value) => update({ parallaxIntensity: value })} label="Parallax intensity" /></div></Section><Section title="Accessibility & micro interactions"><SimpleRow title="Reduced motion" value={animation.reducedMotion} onChange={(value) => update({ reducedMotion: Boolean(value) })} /><SimpleRow title="Micro animations" value={animation.micro} onChange={(value) => update({ micro: Boolean(value) })} /><SimpleRow title="Button animations" value={animation.button} onChange={(value) => update({ button: Boolean(value) })} /><SimpleRow title="Library card animations" value={animation.libraryCards} onChange={(value) => update({ libraryCards: Boolean(value) })} /></Section></>; }
function AboutSettings() { return <><Section title="NekoVerse"><SimpleRow title="App version" value="1.5.0" icon={Info} /><SimpleRow title="Changelog" value="Read notes" /><SimpleRow title="Credits" value="The NekoVerse community" /><SimpleRow title="Privacy policy" value="View policy" /><SimpleRow title="Open source licenses" value="View licenses" /><SimpleRow title="About NekoVerse" value="Made for after-hours" /></Section></>; }
function NotFound() { const [, navigate] = useLocation(); return <div className="px-5 pt-24 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-pink-soft)] text-[var(--app-pink-text)]"><Info size={22} /></div><h1 className="mt-5 font-display text-[26px] font-bold">Signal lost</h1><p className="mt-2 text-[12px] text-[var(--app-subtle)]">This story is not in the constellation.</p><button type="button" onClick={() => navigate('/')} className="mt-6 rounded-full bg-[var(--app-pink)] px-5 py-2.5 text-[11px] font-semibold text-white">Return home</button></div>; }

function AppContent() {
  const catalog = useCatalog();
  const [settings, setSettings] = useStored<AppSettings>('nekoverse-settings', defaultSettings);
  const [library, setLibrary] = useStored<Record<string, Status>>('nekoverse-library', {});
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!catalog.allMedia.length) return;
    setLibrary((current) => {
      const next = { ...current };
      let changed = false;
      catalog.allMedia.forEach((item) => {
        if (!(item.id in next)) {
          next[item.id] = item.status;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [catalog.allMedia, setLibrary]);
  const updateSettings = (patch: Partial<AppSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const updateAnimation = (patch: Partial<AppSettings['animation']>) => setSettings((current) => ({ ...current, animation: { ...current.animation, ...patch } }));
  const setStatus = (id: string, status: Status) => setLibrary((current) => ({ ...current, [id]: status }));
  const remove = (id: string) => setLibrary((current) => { const next = { ...current }; delete next[id]; return next; });
  const notify = (nextMessage: string) => { setMessage(nextMessage); window.setTimeout(() => setMessage(''), 2100); };
  const state = useMemo<NekoState>(() => ({
    ...catalog,
    catalogLoading: catalog.loading,
    catalogError: catalog.error,
    refreshCatalog: catalog.refresh,
    settings,
    theme: settings.theme === 'Light' ? 'light' : 'dark',
    library,
    setStatus,
    remove,
    updateSettings,
    updateAnimation,
    notify,
  }), [catalog, settings, library]);
  return <NekoContext.Provider value={state}><Shell><Switch><Route path="/" component={HomePage} /><Route path="/explore" component={ExplorePage} /><Route path="/library" component={LibraryPage} /><Route path="/profile" component={ProfilePage} /><Route path="/settings" component={SettingsPage} /><Route path="/watch/:id/:episode" component={WatchPage} /><Route path="/read/:id/:chapter" component={ReaderPage} /><Route path="/anime/:id"><DetailPage type="anime" /></Route><Route path="/manga/:id"><DetailPage type="manga" /></Route><Route component={NotFound} /></Switch></Shell>{message && <div role="status" className="fixed bottom-[74px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--app-text)] px-4 py-2.5 text-[11px] font-semibold text-[var(--app-bg)] shadow-xl"><Check size={13} className="text-[var(--app-pink)]" />{message}</div>}</NekoContext.Provider>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#e52f68',
    colorForeground: '#f5f1f2',
    colorMutedForeground: '#a59aa0',
    colorDanger: '#ff7e9f',
    colorBackground: '#1c171b',
    colorInput: '#252025',
    colorInputForeground: '#f5f1f2',
    colorNeutral: '#4f454b',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '1rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#1c171b] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#f5f1f2]',
    headerSubtitle: 'text-[#a59aa0]',
    socialButtonsBlockButtonText: 'text-[#f5f1f2]',
    formFieldLabel: 'text-[#f5f1f2]',
    footerActionLink: 'text-[#ff7e9f]',
    footerActionText: 'text-[#a59aa0]',
    dividerText: 'text-[#a59aa0]',
    formFieldInput: 'bg-[#252025] text-[#f5f1f2] border-[#4f454b]',
    formButtonPrimary: 'bg-[#e52f68] hover:bg-[#ff4779]',
  },
};

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--app-bg)] px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[var(--app-bg)] px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClientInstance = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const nextUserId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) queryClientInstance.clear();
    previousUserId.current = nextUserId;
  }), [addListener, queryClientInstance]);
  return null;
}

function RoutedApp() {
  return <Switch><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route component={AppContent} /></Switch>;
}

function App() {
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} routerPush={(to) => window.history.pushState({}, '', to)} routerReplace={(to) => window.history.replaceState({}, '', to)} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to connect your accounts' } }, signUp: { start: { title: 'Create your NekoVerse account', subtitle: 'Keep every connection in your own orbit' } } }}><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkQueryClientCacheInvalidator /><RoutedErrorBoundary><RoutedApp /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}
export default App;