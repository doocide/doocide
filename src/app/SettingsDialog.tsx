import { useState } from 'react';
import { LIMITS } from '../format/limits';
import type { Decision } from '../format/types';
import { t } from '../i18n';
import { CONTENT_LANGUAGES, nativeName } from '../i18n/languages';
import { NotesEditor } from './DetailDialog';
import { setDescription, setLang, setSettings, type Edit } from './edit';
import { optionName } from './labels';
import { Dialog, Segmented } from './ui';

export function SettingsDialog({ d, uiLang, onEdit, onClose }: { d: Decision; uiLang: string; onEdit: (e: Edit) => void; onClose: () => void }) {
  const [description, setDescriptionText] = useState(d.description ?? '');
  const langs = CONTENT_LANGUAGES.includes(d.lang) ? CONTENT_LANGUAGES : [d.lang, ...CONTENT_LANGUAGES];
  const pugh = d.settings.mode === 'pugh';

  return (
    <Dialog title={t('settings.title')} onClose={onClose}>
      <label className="field">
        <span className="field-label">{t('settings.description')}</span>
        <textarea
          rows={3}
          value={description}
          dir="auto"
          lang={d.lang}
          maxLength={LIMITS.text.description}
          placeholder={t('settings.descriptionPlaceholder')}
          onChange={(e) => setDescriptionText(e.target.value)}
          onBlur={() => onEdit(setDescription(description))}
        />
      </label>

      <label className="field">
        <span className="field-label">{t('settings.contentLanguage')}</span>
        <span className="muted small">{t('settings.contentLanguageHelp')}</span>
        <select value={d.lang} onChange={(e) => onEdit(setLang(e.target.value))}>
          {langs.map((code) => (
            <option key={code} value={code}>
              {nativeName(code)}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span className="field-label">{t('settings.mode')}</span>
        <Segmented
          value={d.settings.mode}
          label={t('settings.mode')}
          onChange={(mode) => onEdit(setSettings({ mode }))}
          options={[
            { value: 'weighted', label: t('settings.modeWeighted') },
            { value: 'pugh', label: t('settings.modePugh') },
          ]}
        />
        <span className="muted small">{pugh ? t('settings.modePughHelp') : t('settings.modeWeightedHelp')}</span>
      </div>

      {!pugh && (
        <div className="field">
          <span className="field-label">{t('settings.scale')}</span>
          <Segmented
            value={d.settings.scaleMax}
            label={t('settings.scale')}
            onChange={(scaleMax) => onEdit(setSettings({ scaleMax }))}
            options={[5, 10, 100].map((n) => ({ value: n, label: `0–${n}` }))}
          />
        </div>
      )}

      {pugh && (
        <>
          <div className="field">
            <span className="field-label">{t('settings.pughSteps')}</span>
            <Segmented
              value={d.settings.pughSteps}
              label={t('settings.pughSteps')}
              onChange={(pughSteps) => onEdit(setSettings({ pughSteps }))}
              options={[
                { value: 1, label: '− S +' },
                { value: 2, label: '−− − S + ++' },
              ]}
            />
          </div>
          <label className="field">
            <span className="field-label">{t('settings.baseline')}</span>
            <span className="muted small">{t('settings.baselineHelp')}</span>
            <select value={d.settings.baselineId ?? ''} onChange={(e) => onEdit(setSettings({ baselineId: e.target.value || undefined }))}>
              <option value="">{t('settings.noBaseline')}</option>
              {d.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionName(d, o, uiLang)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <NotesEditor d={d} target={{}} readOnly={false} onEdit={onEdit} />
    </Dialog>
  );
}
