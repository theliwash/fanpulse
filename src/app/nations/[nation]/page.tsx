import NationSentimentClient from '@/components/NationSentimentClient';
import Link from 'next/link';

const TEAM_FLAGS: Record<string, string> = {
  "Argentina": "🇦🇷",
  "Brazil": "🇧🇷",
  "England": "ENG 🏴",
  "Scotland": "SCO 🏴",
  "Korea Republic": "🇰🇷",
  "IR Iran": "🇮🇷",
  "USA": "🇺🇸",
  "Türkiye": "🇹🇷",
  "Bosnia and Herzegovina": "🇧🇦",
};

export default function Page({ params }: { params: { nation: string } }) {
  const nation = decodeURIComponent(params.nation || '');

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="text-3xl">{TEAM_FLAGS[nation] ?? '🏴'}</div>
            <h1 className="text-2xl font-bold">{nation}</h1>
          </div>
          <div>
            <Link href="/dashboard" className="text-gray-400 hover:underline">← Back</Link>
          </div>
        </div>

        <NationSentimentClient nation={nation} />
      </div>
    </main>
  );
}
