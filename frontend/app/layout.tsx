import type { Metadata } from 'next';

import './globals.css';
import { THEME_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Yu-tomation — AI Workflow Builder',
  description: 'Build, run and recover AI video workflows.',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint, so the page never renders in one theme
          and swaps to the other. `suppressHydrationWarning` above is because of
          exactly this: the attribute it sets is not in the server's markup.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
