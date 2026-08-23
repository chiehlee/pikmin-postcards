import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '設定 · Pikmin 明信片收藏研究庫',
  description: '設定明信片研究使用的 server-side OpenAI 連線與模型。',
};

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
