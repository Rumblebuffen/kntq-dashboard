import { useEffect, useMemo, useState } from 'react';
import { REPO, type PageData, loadPageData } from './data';
import { Time } from './ui';
import { useScenario } from './urlState';
import { buildView } from './viewModel';
import { AssumptionsPanel, BreakEvenPanel, ChartControls, CumulativeChart, DailyChart, FlowChart, Headline, HealthPanel, OverhangPanel, SourcesTable } from './views';

export function App() {
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sc, update, reset] = useScenario();

  useEffect(() => {
    let alive = true;
    const load = () =>
      loadPageData()
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(String(e)));
    load();
    const timer = window.setInterval(load, 10 * 60_000); // data changes hourly; re-read without a reload
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const view = useMemo(() => (data ? buildView(data, sc) : null), [data, sc]);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-5 pb-16 sm:px-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">KNTQ burn vs unlock</h1>
        <p className="mt-1 text-sm text-ink2">How much supply is permanently removed, compared with how much is released to the team and investors.</p>
        {data && (
          <p className="mt-1 text-xs text-muted">
            Data as of <Time ms={data.generatedAt} /> · updates hourly
          </p>
        )}
      </header>

      {error && !data && (
        <div role="alert" className="rounded-xl border border-line bg-surface p-4 text-sm text-ink">
          The data could not be loaded. Check your connection and reload.
          <div className="mt-1 text-xs break-all text-ink2">{error}</div>
        </div>
      )}
      {!data && !error && <p className="text-sm text-ink2">Loading the latest snapshot…</p>}

      {data && view && (
        <main className="space-y-4">
          <Headline v={view} sc={sc} update={update} />
          <ChartControls sc={sc} update={update} />
          <DailyChart v={view} sc={sc} />
          <CumulativeChart v={view} sc={sc} />
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <BreakEvenPanel v={view} />
            </div>
            <div className="lg:col-span-3">
              <FlowChart v={view} sc={sc} />
            </div>
          </div>
          <AssumptionsPanel v={view} d={data} sc={sc} update={update} reset={reset} />
          <SourcesTable v={view} />
          <OverhangPanel v={view} d={data} />
          <HealthPanel v={view} d={data} />
          <footer className="pt-2 text-xs text-muted">
            Not financial advice. Times are ICT (UTC+7); hover a time for UTC. Method, data and code:{' '}
            <a className="underline" href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer">
              github.com/{REPO}
            </a>
            .
          </footer>
        </main>
      )}
    </div>
  );
}
