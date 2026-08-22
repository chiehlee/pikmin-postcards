import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'http://localhost:3000'),
  title: 'Pikmin Postcard Archive',
  description: '保存 Pikmin Bloom 明信片、地方研究、收藏判斷與朋友活動範圍證據。',
  openGraph: {
    title: 'Pikmin Postcard Archive',
    description: '把一張明信片，讀成一個地方的故事。',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pikmin Postcard Archive',
    description: '把一張明信片，讀成一個地方的故事。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
