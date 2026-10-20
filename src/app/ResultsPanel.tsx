import type { Analysis, Flip, Results } from '../engine';
import type { Decision } from '../format/types';
import { formatNumber, t } from '../i18n';
import { formatValue } from './controls';
import { factorName, optionName } from './labels';
import { Icon } from './ui';

function flipSentence(d: Decision, flip: Flip, winnerName: string, uiLang: string): string {
  const option = (id: string) => {
    const o = d.options.find((x) => x.id === id);
    return o ? optionName(d, o, uiLang) : '';
  };
  const factor = (id: string) => {
    const f = d.factors.find((x) => x.id === id);
    return f ? factorName(d, f, uiLang) : '';
  };
  const challenger = option(flip.challengerId);
  if (flip.kind === 'weight') {
    return t('results.flipWeight', {
      winner: winnerName,
      challenger,
      factor: factor(flip.factorId),
      from: t(`weight.${flip.from}`),
      to: t(`weight.${flip.to}`),
    });
  }
  if (flip.optionId === flip.challengerId) {
    return t('results.flipScoreSelf', { challenger, factor: factor(flip.factorId), from: formatValue(d, flip.from), to: formatValue(d, flip.to) });
  }
  return t('results.flipScore', {
    winner: winnerName,
    challenger,
    option: option(flip.optionId),
    factor: factor(flip.factorId),
    from: formatValue(d, flip.from),
    to: formatValue(d, flip.to),
  });
}

export function ResultsPanel({ d, results, analysis, uiLang }: { d: Decision; results: Results; analysis: Analysis; uiLang: string }) {
  const pugh = d.settings.mode === 'pugh';
  const winner = d.options.find((o) => o.id === results.winnerId);
  const winnerName = winner ? optionName(d, winner, uiLang) : '';
  const missing = results.ranking.reduce((sum, r) => sum + (d.factors.length - r.scored), 0);

  let verdict: { tone: string; title: string; text?: string };
  if (results.needsBaseline) verdict = { tone: 'info', title: t('results.needsBaseline') };
  else if (analysis.robustness === 'none') verdict = { tone: 'info', title: t('results.none') };
  else if (analysis.robustness === 'unscored') verdict = { tone: 'info', title: t('results.unscored') };
  else if (analysis.robustness === 'incomplete') verdict = { tone: 'info', title: t('results.incomplete', { count: missing }) };
  else if (analysis.robustness === 'coin-flip') verdict = { tone: 'warn', title: t('results.coinFlip'), text: t('results.coinFlipText') };
  else if (analysis.robustness === 'close') verdict = { tone: 'warn', title: t('results.close'), text: t('results.closeText') };
  else verdict = { tone: 'good', title: t('results.clear'), text: t('results.clearText') };

  const flips = [analysis.weightFlip, analysis.scoreFlip].filter((f): f is Flip => Boolean(f));

  return (
    <section className="results" aria-labelledby="results-title">
      <h2 id="results-title">{t('results.title')}</h2>
      <div className={`verdict ${verdict.tone}`}>
        <strong>{verdict.title}</strong>
        {verdict.text && <p>{verdict.text}</p>}
        {winner && flips.length > 0 && analysis.robustness !== 'incomplete' && (
          <ul className="flips">
            {flips.map((f) => (
              <li key={f.kind} dir="auto">
                {flipSentence(d, f, winnerName, uiLang)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ol className="ranking">
        {results.ranking.map((r) => {
          const o = d.options.find((x) => x.id === r.optionId);
          if (!o) return null;
          const win = results.winnerId === r.optionId;
          const width = pugh ? Math.max(0, (r.percent + 100) / 2) : Math.max(0, r.percent);
          return (
            <li key={r.optionId} className={win ? 'win' : ''}>
              <div className="rank-line">
                <span className="rank">{results.needsBaseline || !results.hasScores ? '' : `#${r.rank}`}</span>
                <span className="name" dir="auto" lang={d.lang}>
                  {optionName(d, o, uiLang)}
                </span>
                {win && <Icon name="trophy" size={16} />}
                <span className="value">
                  {pugh ? (r.isBaseline ? t('pugh.baseline') : `${r.total > 0 ? '+' : ''}${formatNumber(r.total)}`) : `${formatNumber(r.percent, 1)}%`}
                </span>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${width}%` }} />
              </div>
              <div className="rank-meta muted small">
                {pugh && !r.isBaseline && t('results.pughCounts', { better: r.better ?? 0, same: r.same ?? 0, worse: r.worse ?? 0 })}
                {!r.complete && <span className="badge">{t('results.scoredOf', { scored: r.scored, total: d.factors.length })}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
