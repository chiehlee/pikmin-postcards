import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_ORIGIN ?? 'http://localhost:3000'),
  title: 'Pikmin 明信片收藏研究庫',
  description: '保存 Pikmin Bloom 明信片、地方研究、收藏判斷與朋友活動範圍證據。',
  openGraph: {
    title: 'Pikmin 明信片收藏研究庫',
    description: '保存 Pikmin Bloom 明信片、地方研究、收藏判斷與朋友活動範圍證據。',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pikmin 明信片收藏研究庫',
    description: '保存 Pikmin Bloom 明信片、地方研究、收藏判斷與朋友活動範圍證據。',
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
