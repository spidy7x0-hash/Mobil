import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Captions,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gauge,
  ListVideo,
  Lock,
  Maximize,
  Minimize,
  MonitorPlay,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipBack,
  SkipForward,
  Subtitles,
  Unlock,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

export type PlayerMedia = {
  id: string;
  title: string;
  episodes: number;
  image: string;
};

/**
 * Sources stay declarative so a real provider can supply an authorized URL
 * later without changing the player controls or adding scraping behavior.
 */
type VideoSource = {
  id: string;
  label: string;
  provider: string;
  url: string;
};

const DEMO_VIDEO = `${import.meta.env.BASE_URL}nekoverse-demo.mp4`;

const VIDEO_SOURCES: VideoSource[] = [
  {
    id: 'demo',
    label: 'NekoVerse Demo',
    provider: 'Demo provider',
    url: DEMO_VIDEO,
  },
];

const QUALITY_OPTIONS = ['Auto', '360p', '720p', '1080p'];
const SUBTITLE_OPTIONS = ['English', 'Spanish', 'Japanese', 'Off'];
const SPEED_OPTIONS = ['0.75x', '1x', '1.25x', '1.5x', '2x'];

type PlayerMenu = 'episodes' | 'sources' | 'quality' | 'subtitles' | 'speed' | null;

type VideoWithPictureInPicture = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<void>;
};

type DocumentWithPictureInPicture = Document & {
  pictureInPictureElement?: Element;
  exitPictureInPicture?: () => Promise<void>;
  pictureInPictureEnabled?: boolean;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function ControlButton({
  label,
  onClick,
  children,
  disabled = false,
  className = '',
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 shrink-0 items-center justify-center rounded-xl text-white transition hover:bg-white/15 active:scale-95 disabled:pointer-events-none disabled:opacity-35 ${className}`}
    >
      {children}
    </button>
  );
}

function MenuButton({
  label,
  value,
  onClick,
  icon,
}: {
  label: string;
  value: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-white/[.08] px-2.5 text-left text-[10px] text-white transition hover:bg-white/15 active:scale-95"
      aria-label={`${label}: ${value}`}
      title={`${label}: ${value}`}
    >
      {icon}
      <span className="hidden min-[430px]:inline">
        <span className="block text-[8px] uppercase tracking-[.12em] text-white/45">
          {label}
        </span>
        <span className="block font-semibold">{value}</span>
      </span>
      <ChevronDown size={13} className="text-white/55" />
    </button>
  );
}

function SelectionMenu({
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  title: string;
  options: { value: string; label: string; description?: string }[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={{ duration: 0.16 }}
      className="absolute bottom-20 right-3 z-50 w-[min(290px,calc(100%-24px))] overflow-hidden rounded-2xl border border-white/10 bg-[#171116]/95 p-2 shadow-2xl backdrop-blur-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between px-2 py-2">
        <p className="text-[10px] font-semibold text-white">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="rounded-full p-1 text-white/55 hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <button
              type="button"
              key={option.value}
              onClick={() => onSelect(option.value)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                active
                  ? 'bg-[var(--app-pink)] text-white'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold">
                  {option.label}
                </span>
                {option.description && (
                  <span
                    className={`mt-0.5 block truncate text-[9px] ${
                      active ? 'text-white/70' : 'text-white/40'
                    }`}
                  >
                    {option.description}
                  </span>
                )}
              </span>
              {active && <span className="text-[10px] font-bold">Selected</span>}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

export function VideoPlayer({
  item,
  episode,
  autoNext,
  onBack,
  onEpisodeChange,
}: {
  item: PlayerMedia;
  episode: number;
  autoNext: boolean;
  onBack: () => void;
  onEpisodeChange: (episode: number) => void;
}) {
  const playerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<VideoWithPictureInPicture | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const singleTapTimerRef = useRef<number | undefined>(undefined);
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right' } | null>(
    null,
  );
  const lastVolumeRef = useRef(0.75);
  const storageKey = `nekoverse-watch-${item.id}-${episode}`;

  const [sourceId, setSourceId] = useState(VIDEO_SOURCES[0].id);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.75);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState('1x');
  const [quality, setQuality] = useState('Auto');
  const [subtitles, setSubtitles] = useState('English');
  const [menu, setMenu] = useState<PlayerMenu>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState(false);

  const source = useMemo(
    () => VIDEO_SOURCES.find((entry) => entry.id === sourceId) ?? VIDEO_SOURCES[0],
    [sourceId],
  );
  const episodeOptions = useMemo(
    () =>
      Array.from({ length: Math.min(item.episodes, 12) }, (_, index) => ({
        value: String(index + 1),
        label: `Episode ${index + 1}`,
        description:
          index + 1 === episode ? 'Currently playing' : 'Open this episode',
      })),
    [episode, item.episodes],
  );
  const sourceOptions = useMemo(
    () =>
      VIDEO_SOURCES.map((entry) => ({
        value: entry.id,
        label: entry.label,
        description: entry.provider,
      })),
    [],
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearHideTimer();
  }, [clearHideTimer]);

  useEffect(() => {
    clearHideTimer();
    if (playing && controlsVisible && !locked && !menu) {
      hideTimerRef.current = window.setTimeout(
        () => setControlsVisible(false),
        4200,
      );
    }
    return clearHideTimer;
  }, [clearHideTimer, controlsVisible, locked, menu, playing]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const saveProgress = () =>
      localStorage.setItem(storageKey, String(video.currentTime || 0));
    const timer = window.setInterval(saveProgress, 5000);
    return () => {
      window.clearInterval(timer);
      saveProgress();
    };
  }, [storageKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setProgress(0);
    setPlaying(false);
    setError(false);
    video.load();
  }, [sourceId]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current !== undefined) {
        window.clearTimeout(singleTapTimerRef.current);
      }
      clearHideTimer();
    };
  }, [clearHideTimer]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setError(false);
      video.play().catch(() => setError(true));
    } else {
      video.pause();
    }
    revealControls();
  };

  const seek = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(duration) && duration > 0 ? duration : video.duration;
    video.currentTime = Math.max(0, Math.min(max || Number.MAX_SAFE_INTEGER, video.currentTime + delta));
    setProgress(video.currentTime);
    revealControls();
  };

  const setCurrentTime = (value: number) => {
    setProgress(value);
    if (videoRef.current) videoRef.current.currentTime = value;
    revealControls();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (muted || volume === 0) {
      const nextVolume = lastVolumeRef.current || 0.75;
      setVolume(nextVolume);
      setMuted(false);
      if (video) video.volume = nextVolume;
    } else {
      lastVolumeRef.current = volume;
      setVolume(0);
      setMuted(true);
      if (video) video.volume = 0;
    }
    revealControls();
  };

  const changeVolume = (value: number) => {
    setVolume(value);
    setMuted(value === 0);
    if (value > 0) lastVolumeRef.current = value;
    if (videoRef.current) videoRef.current.volume = value;
    revealControls();
  };

  const changeSpeed = (value: string) => {
    setSpeed(value);
    if (videoRef.current) videoRef.current.playbackRate = Number.parseFloat(value);
    setMenu(null);
    revealControls();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      playerRef.current?.requestFullscreen?.();
    }
    revealControls();
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    const pipDocument = document as DocumentWithPictureInPicture;
    if (!video) return;
    try {
      if (pipDocument.pictureInPictureElement && pipDocument.exitPictureInPicture) {
        await pipDocument.exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch {
      // Browsers can reject PiP when the document is not user-activated.
    }
    revealControls();
  };

  const handleStageTap = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input')) return;
    if (locked) {
      revealControls();
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientX - bounds.left < bounds.width / 2 ? 'left' : 'right';
    const now = Date.now();
    const previous = lastTapRef.current;

    if (previous && now - previous.time < 280 && previous.side === side) {
      if (singleTapTimerRef.current !== undefined) {
        window.clearTimeout(singleTapTimerRef.current);
      }
      lastTapRef.current = null;
      seek(side === 'left' ? -10 : 10);
      return;
    }

    lastTapRef.current = { time: now, side };
    if (singleTapTimerRef.current !== undefined) {
      window.clearTimeout(singleTapTimerRef.current);
    }
    singleTapTimerRef.current = window.setTimeout(() => {
      setControlsVisible((visible) => !visible);
      lastTapRef.current = null;
    }, 280);
  };

  const onPlayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' || event.key === 'k') {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seek(-10);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seek(10);
    } else if (event.key === 'f') {
      event.preventDefault();
      toggleFullscreen();
    }
  };

  const controlsClass = controlsVisible && !locked
    ? 'opacity-100'
    : 'pointer-events-none opacity-0';

  const pipDocument = document as DocumentWithPictureInPicture;
  const pipSupported = Boolean(
    pipDocument.pictureInPictureEnabled || videoRef.current?.requestPictureInPicture,
  );

  return (
    <div
      ref={playerRef}
      tabIndex={0}
      onKeyDown={onPlayerKeyDown}
      onClick={handleStageTap}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
      className="watch-player group relative h-[100svh] min-h-[500px] w-full overflow-hidden bg-black text-white outline-none"
      aria-label={`${item.title} video player`}
    >
      <div
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-3xl"
        style={{ backgroundImage: `url(${item.image})` }}
        aria-hidden="true"
      />
      <video
        ref={videoRef}
        key={source.url}
        src={source.url}
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-contain"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          const saved = Number(localStorage.getItem(storageKey) || 0);
          if (saved > 0 && saved < video.duration) video.currentTime = saved;
          video.volume = muted ? 0 : volume;
          video.playbackRate = Number.parseFloat(speed);
        }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          if (autoNext && episode < item.episodes) onEpisodeChange(episode + 1);
          else setPlaying(false);
        }}
        onError={() => setError(true)}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/75 via-transparent via-35% to-black/90" />

      <div className={`absolute inset-x-0 top-0 z-30 transition duration-300 ${controlsClass}`}>
        <div
          className="pointer-events-auto flex items-start justify-between gap-3 px-4 pb-5 pt-[max(16px,env(safe-area-inset-top))] sm:px-8"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to title"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md transition hover:bg-white/15"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[13px] font-bold sm:text-[15px]">{item.title}</p>
            <p className="mt-1 text-[10px] text-white/60 sm:text-[11px]">
              Season 1 · Episode {episode}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <MenuButton
              label="Source"
              value={source.label}
              onClick={() => setMenu(menu === 'sources' ? null : 'sources')}
              icon={<MonitorPlay size={15} />}
            />
            <ControlButton
              label={locked ? 'Unlock controls' : 'Lock controls'}
              onClick={() => {
                setLocked((value) => !value);
                setMenu(null);
              }}
              className="w-10 bg-black/25"
            >
              {locked ? <Unlock size={17} /> : <Lock size={17} />}
            </ControlButton>
          </div>
        </div>
      </div>

      <div className={`absolute inset-0 z-20 flex items-center justify-center transition duration-300 ${controlsClass}`}>
        <div
          className="pointer-events-auto flex items-center gap-5 sm:gap-10"
          onClick={(event) => event.stopPropagation()}
        >
          <ControlButton
            label="Previous episode"
            onClick={() => onEpisodeChange(episode - 1)}
            disabled={episode <= 1}
            className="h-12 w-12 bg-black/25 sm:h-14 sm:w-14"
          >
            <SkipBack size={22} fill="currentColor" />
          </ControlButton>
          <button
            type="button"
            aria-label={playing ? 'Pause video' : 'Play video'}
            onClick={togglePlayback}
            className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-[var(--app-pink)] text-white shadow-[0_0_42px_color-mix(in_srgb,var(--app-pink)_65%,transparent)] transition hover:scale-105 active:scale-95 sm:h-[92px] sm:w-[92px]"
          >
            {playing ? (
              <Pause size={34} fill="currentColor" />
            ) : (
              <Play size={38} fill="currentColor" className="ml-1" />
            )}
          </button>
          <ControlButton
            label="Next episode"
            onClick={() => onEpisodeChange(episode + 1)}
            disabled={episode >= item.episodes}
            className="h-12 w-12 bg-black/25 sm:h-14 sm:w-14"
          >
            <SkipForward size={22} fill="currentColor" />
          </ControlButton>
        </div>
      </div>

      <div className={`absolute inset-x-0 bottom-0 z-30 transition duration-300 ${controlsClass}`}>
        <div
          className="pointer-events-auto mx-auto max-w-[1100px] bg-gradient-to-t from-black/95 via-black/75 to-transparent px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-14 sm:px-8"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-3 text-[10px] text-white/70">
            <span className="w-10 shrink-0 font-code">{formatTime(progress)}</span>
            <input
              aria-label="Playback progress"
              type="range"
              min="0"
              max={Math.max(duration, 1)}
              step="0.1"
              value={Math.min(progress, Math.max(duration, 1))}
              onChange={(event) => setCurrentTime(Number(event.target.value))}
              className="player-progress min-w-0 flex-1"
            />
            <span className="w-10 shrink-0 text-right font-code">{formatTime(duration)}</span>
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <ControlButton label={playing ? 'Pause' : 'Play'} onClick={togglePlayback} className="w-10">
              {playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}
            </ControlButton>
            <ControlButton label="Rewind 10 seconds" onClick={() => seek(-10)} className="w-10">
              <span className="relative">
                <RotateCcw size={17} />
                <span className="absolute inset-0 flex items-center justify-center pt-0.5 text-[7px] font-bold">
                  10
                </span>
              </span>
            </ControlButton>
            <ControlButton label="Forward 10 seconds" onClick={() => seek(10)} className="w-10">
              <span className="relative">
                <RotateCw size={17} />
                <span className="absolute inset-0 flex items-center justify-center pt-0.5 text-[7px] font-bold">
                  10
                </span>
              </span>
            </ControlButton>
            <ControlButton
              label={muted ? 'Unmute' : 'Mute'}
              onClick={toggleMute}
              className="w-10"
            >
              {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </ControlButton>
            <input
              aria-label="Volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
              className="player-volume hidden w-20 sm:block"
            />
            <div className="ml-auto flex min-w-0 gap-1.5 overflow-x-auto hide-scrollbar">
              <MenuButton
                label="Episode"
                value={`E${episode}`}
                onClick={() => setMenu(menu === 'episodes' ? null : 'episodes')}
                icon={<ListVideo size={15} />}
              />
              <MenuButton
                label="Quality"
                value={quality}
                onClick={() => setMenu(menu === 'quality' ? null : 'quality')}
                icon={<Settings2 size={15} />}
              />
              <MenuButton
                label="Subtitles"
                value={subtitles}
                onClick={() => setMenu(menu === 'subtitles' ? null : 'subtitles')}
                icon={<Captions size={15} />}
              />
              <MenuButton
                label="Speed"
                value={speed}
                onClick={() => setMenu(menu === 'speed' ? null : 'speed')}
                icon={<Gauge size={15} />}
              />
              {pipSupported && (
                <ControlButton
                  label="Picture in picture"
                  onClick={togglePictureInPicture}
                  className="w-10 bg-white/[.08]"
                >
                  <PictureInPicture2 size={16} />
                </ControlButton>
              )}
              <ControlButton
                label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                onClick={toggleFullscreen}
                className="w-10 bg-white/[.08]"
              >
                {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
              </ControlButton>
            </div>
          </div>
        </div>
      </div>

      {locked && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setLocked(false);
            revealControls();
          }}
          className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] z-40 flex h-10 items-center gap-2 rounded-full bg-black/55 px-3 text-[10px] font-semibold text-white backdrop-blur-md"
        >
          <Unlock size={15} />
          Unlock controls
        </button>
      )}

      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-6 text-center">
          <div>
            <p className="text-sm font-semibold text-white">Video source unavailable</p>
            <p className="mt-1 text-[10px] text-white/60">
              The selected provider did not return a playable source.
            </p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setError(false);
                videoRef.current?.load();
              }}
              className="mt-4 rounded-full bg-[var(--app-pink)] px-4 py-2 text-[10px] font-semibold text-white"
            >
              Retry source
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {menu === 'episodes' && (
          <SelectionMenu
            title="Choose episode"
            options={episodeOptions}
            selected={String(episode)}
            onSelect={(value) => {
              onEpisodeChange(Number(value));
              setMenu(null);
              revealControls();
            }}
            onClose={() => setMenu(null)}
          />
        )}
        {menu === 'sources' && (
          <SelectionMenu
            title="Choose source"
            options={sourceOptions}
            selected={sourceId}
            onSelect={(value) => {
              setSourceId(value);
              setMenu(null);
              revealControls();
            }}
            onClose={() => setMenu(null)}
          />
        )}
        {menu === 'quality' && (
          <SelectionMenu
            title="Playback quality"
            options={QUALITY_OPTIONS.map((value) => ({
              value,
              label: value,
              description: value === 'Auto' ? 'Adjust to your connection' : 'Preferred stream quality',
            }))}
            selected={quality}
            onSelect={(value) => {
              setQuality(value);
              setMenu(null);
              revealControls();
            }}
            onClose={() => setMenu(null)}
          />
        )}
        {menu === 'subtitles' && (
          <SelectionMenu
            title="Subtitles"
            options={SUBTITLE_OPTIONS.map((value) => ({
              value,
              label: value,
              description: value === 'Off' ? 'Hide subtitles' : 'Subtitle track',
            }))}
            selected={subtitles}
            onSelect={(value) => {
              setSubtitles(value);
              setMenu(null);
              revealControls();
            }}
            onClose={() => setMenu(null)}
          />
        )}
        {menu === 'speed' && (
          <SelectionMenu
            title="Playback speed"
            options={SPEED_OPTIONS.map((value) => ({
              value,
              label: value,
              description: value === '1x' ? 'Normal speed' : 'Adjust playback speed',
            }))}
            selected={speed}
            onSelect={changeSpeed}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>

      {!controlsVisible && !locked && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1.5 text-[9px] text-white/50 backdrop-blur-sm">
          Tap for controls · Double-tap to seek
        </div>
      )}
    </div>
  );
}