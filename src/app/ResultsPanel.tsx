import { disagreements, spreadLevel, weightDisagreements, type Analysis, type Flip, type Results } from '../engine';
import type { Decision, GroupResult } from '../format/types';
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

/** Where the group disagrees most, in plain sentences. */
function Disagreements({ d, result, uiLang }: { d: Decision; result: GroupResult; uiLang: string }) {
  const cells = disagreements(result);
  const weights = weightDisagreements(result);
  const option = (id: string) => {
    const o = d.options.find((x) => x.id === id);
    return o ? optionName(d, o, uiLang) : '';
  };
  const factor = (id: string) => {
    const f = d.factors.find((x) => x.id === id);
    return f ? factorName(d, f, uiLang) : '';
  };
  let body;
  if (result.ballots < 2) body = <p className="muted small">{t('disagree.needTwo')}</p>;
  else if (!cells.length && !weights.length) body = <p className="muted small">{t('disagree.none')}</p>;
  else {
    body = (
      <ul className="disagree-list">
        {cells.map((c) => (
          <li key={`${c.optionId} ${c.factorId}`} className={`split-${spreadLevel(c.spread)}`} dir="auto">
            {t('disagree.cell', { option: option(c.optionId), factor: factor(c.factorId), low: formatValue(d, c.low), high: formatValue(d, c.high) })}
          </li>
        ))}
        {weights.map((w) => (
          <li key={w.factorId} className={`split-${spreadLevel(w.spread)}`} dir="auto">
            {t('disagree.weight', { factor: factor(w.factorId), low: t(`weight.${Math.round(w.low)}`), high: t(`weight.${Math.round(w.high)}`) })}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="disagree" aria-labelledby="disagree-title">
      <h3 id="disagree-title">{t('disagree.title')}</h3>
      {body}
    </section>
  );
}

export function ResultsPanel({
  d,
  results,
  analysis,
  uiLang,
  group,
  abstained = [],
  selected = [],
  summary,
}: {
  d: Decision;
  results: Results;
  analysis: Analysis;
  uiLang: string;
  group?: GroupResult;
  /** Options you abstain from, by name: left out of your ranking, listed under it. */
  abstained?: string[];
  /** The options the organizer selected: a badge in the ranking. */
  selected?: string[];
  /** The organizer's summary, shown to everyone else as their text in a marked frame. `from`: their name, when the group is named. */
  summary?: { text: string; lang: string; from?: string };
}) {
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

  // "What flips it" talks about one score or weight; on a group's averages that would mislead.
  const flips = group ? [] : [analysis.weightFlip, analysis.scoreFlip].filter((f): f is Flip => Boolean(f));

  return (
    <section className="results" aria-labelledby="results-title">
      <h2 id="results-title">{group ? t('results.groupTitle') : t('results.title')}</h2>
      {group && <p className="muted small">{t('results.groupFrom', { count: group.ballots })}</p>}
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
                {selected.includes(r.optionId) && <span className="badge selected">{t('summary.selectedBadge')}</span>}
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
      {abstained.length > 0 && (
        <p className="muted small">
          {t('results.abstained')}{' '}
          {abstained.map((name, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <bdi lang={d.lang}>{name}</bdi>
            </span>
          ))}
        </p>
      )}
      {summary && (
        <section className="their-summary" aria-labelledby="their-summary-title">
          <h3 id="their-summary-title">
            {t('summary.fromOrganizer')}
            {summary.from && (
              <>
                {' · '}
                <bdi className="author">{summary.from}</bdi> <span className="muted small">{t('incoming.notVerified')}</span>
              </>
            )}
          </h3>
          <p className="their-text" dir="auto" lang={summary.lang}>
            {summary.text}
          </p>
        </section>
      )}
      {group && <Disagreements d={d} result={group} uiLang={uiLang} />}
    </section>
  );
}
