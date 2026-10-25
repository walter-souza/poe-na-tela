import React, { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { getEmbeds, splitLinks, type ChatEmbed } from '../utils/chatLinks';

// Nothing is requested from the linked host until the user clicks play, so a pasted link
// cannot reveal the viewers' IPs on its own.
const EmbedPlayer: React.FC<{ embed: ChatEmbed }> = ({ embed }) => {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={embed.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="block mt-1 text-xs text-gray-400 hover:text-indigo-300 underline"
      >
        Não foi possível reproduzir aqui. Abrir {embed.host}
      </a>
    );
  }

  if (!playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        title={`Reproduzir vídeo de ${embed.host}`}
        className="mt-1 w-full max-w-xs aspect-video rounded-lg border border-white/10 bg-black/60 hover:bg-black/40 flex flex-col items-center justify-center gap-1.5 transition cursor-pointer"
      >
        <span className="p-3 rounded-full bg-white/15">
          <Play className="w-5 h-5 text-white fill-white" />
        </span>
        <span className="text-[11px] text-gray-400">{embed.host}</span>
      </button>
    );
  }

  if (embed.kind === 'youtube') {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${embed.id}?autoplay=1`}
        title="Vídeo do YouTube"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="mt-1 w-full max-w-xs aspect-video rounded-lg border border-white/10"
      />
    );
  }

  return (
    <video
      src={embed.url}
      controls
      autoPlay
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
      className="mt-1 w-full max-w-xs max-h-72 rounded-lg border border-white/10 bg-black"
    />
  );
};

export const ChatMessageText: React.FC<{ text: string }> = ({ text }) => {
  const segments = useMemo(() => splitLinks(text), [text]);
  const embeds = useMemo(() => getEmbeds(segments), [segments]);

  return (
    <>
      <span className="text-gray-100 break-words whitespace-pre-wrap selection:bg-indigo-500/30">
        {segments.map((s, i) =>
          s.type === 'link' ? (
            <a
              key={i}
              href={s.value}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-sky-400 hover:underline break-all"
            >
              {s.value}
            </a>
          ) : (
            <React.Fragment key={i}>{s.value}</React.Fragment>
          )
        )}
      </span>
      {embeds.map((embed) => (
        <EmbedPlayer key={embed.url} embed={embed} />
      ))}
    </>
  );
};
