import type { ReactNode } from 'react';

export const metadata = {
  title: 'News Aggregator',
  description: 'Serverless news ingestion and search',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
