import type { Wallpaper } from '@zuvo/protocol';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useAppearance } from '../api';
import { useResolvedTheme } from '../use-resolved-theme';
import { wallpaperStyle } from '../wallpaper-style';

/** Behind the message list: this chat's own wallpaper, else my default; dimmed in the dark theme. */
export function ChatWallpaper(props: {
  wallpaper: Wallpaper | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const appearance = useAppearance();
  const theme = useResolvedTheme();
  const wallpaper = props.wallpaper ?? appearance.wallpaper;
  return (
    <div
      data-testid="chat-wallpaper"
      data-wallpaper={`${wallpaper.kind}:${wallpaper.id}`}
      className={cn(props.className)}
      style={wallpaperStyle(wallpaper, theme, appearance.dim)}
    >
      {props.children}
    </div>
  );
}
