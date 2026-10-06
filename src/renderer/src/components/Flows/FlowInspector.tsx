// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Right-hand drawer that edits the selected block's config. Request / sub-flow
// targets are picked on the node itself; everything else (expressions, scripts,
// delays, loop settings, condition cases, display/log) is edited here. Logic is
// plain sp.* JavaScript, matching request pre/post scripts.

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../../store';
import { BLOCK_SPECS, FLOW_BLOCK_COLORS } from '../../../../shared/flow-blocks';
import { blockIO } from '../../../../shared/flow-io';
import type { FlowBlockType, FlowBlockConfig, FlowConditionCase } from '../../../../shared/types';
import { useT } from '../../i18n';

const INSPECTOR_INPUT = 'w-full text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500';

/** Target-flow control for a Run Flow (subflow) block: rename + open. */
function SubflowTarget({ flowId }: { readonly flowId?: string }) {
  const t = useT();
  const flows = useStore(s => s.flows);
  const renameFlow = useStore(s => s.renameFlow);
  const setActiveFlow = useStore(s => s.setActiveFlow);
  const entry = flowId ? flows[flowId] : undefined;
  const [draft, setDraft] = useState(entry?.data.name ?? '');

  if (!flowId || !entry) {
    return <p className="text-[11px] text-surface-500">{t('Pick the flow to run on the block, then reopen to name it.')}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{t('Target flow')}</label>
      <div className="flex items-center gap-1.5">
        <input
          className={INSPECTOR_INPUT + ' flex-1'}
          defaultValue={entry.data.name}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { const n = draft.trim(); if (n && n !== entry.data.name) renameFlow(flowId, n); }}
          onKeyDown={e => { if (e.key === 'Enter') { const n = draft.trim(); if (n) renameFlow(flowId, n); (e.target as HTMLInputElement).blur(); } }}
        />
        <button
          onClick={() => setActiveFlow(flowId)}
          className="px-2 py-1 text-[11px] text-blue-300 hover:text-blue-200 bg-surface-800 hover:bg-surface-700 rounded whitespace-nowrap"
          title={t('Open this flow')}
        >{t('Open')}</button>
      </div>
    </div>
  );
}

export interface InspectedBlock {
  id: string
  type: FlowBlockType
  config: FlowBlockConfig
  label?: string
  color?: string
}

const INPUT = 'w-full text-xs bg-surface-800 border border-surface-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500';
const MONO = 'w-full text-[11px] font-mono bg-surface-900 border border-surface-700 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 resize-y';

function Field({ label, hint, children }: { readonly label: string; readonly hint?: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-surface-600">{hint}</p>}
    </div>
  );
}

export function FlowInspector({
  block, onPatchConfig, onPatchLabel, onPatchColor, onDuplicate, onDelete, onClose,
}: {
  readonly block: InspectedBlock
  readonly onPatchConfig: (patch: FlowBlockConfig) => void
  readonly onPatchLabel: (label: string) => void
  readonly onPatchColor: (color: string | undefined) => void
  readonly onDuplicate: () => void
  readonly onDelete: () => void
  readonly onClose: () => void
}) {
  const t = useT();
  const spec = BLOCK_SPECS[block.type];
  const cfg = block.config;
  const isStart = block.type === 'start';
  const io = blockIO({ id: block.id, type: block.type, position: { x: 0, y: 0 }, config: cfg });
  const inputs = cfg.inputs ?? [];

  const setCases = (cases: FlowConditionCase[]) => onPatchConfig({ cases });
  const setInputs = (next: { key: string; value: string }[]) => onPatchConfig({ inputs: next });

  return (
    <aside className="w-80 flex-shrink-0 border-l border-surface-800 bg-surface-950 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-surface-800 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-xs font-semibold text-[var(--text-primary)]">{spec.label}</div>
          <div className="text-[10px] text-surface-500">{spec.description}</div>
        </div>
        <button onClick={onClose} title={t('Close')} className="text-surface-600 hover:text-surface-300 text-sm leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {block.type !== 'start' && block.type !== 'end' && (
          <Field label={t('Label')} hint={t('Optional name shown on the block.')}>
            <input className={INPUT} value={block.label ?? ''} placeholder={spec.label} onChange={e => onPatchLabel(e.target.value)} />
          </Field>
        )}

        <Field label={t('Color')}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {FLOW_BLOCK_COLORS.map(c => (
              <button
                key={c.value}
                title={c.name}
                onClick={() => onPatchColor(c.value)}
                className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${block.color === c.value ? 'border-white ring-2 ring-white/40' : 'border-surface-700'}`}
                style={{ backgroundColor: c.value }}
              />
            ))}
            <button
              title={t('Default color')}
              onClick={() => onPatchColor(undefined)}
              className={`w-5 h-5 rounded-full border text-[10px] leading-none text-surface-400 flex items-center justify-center ${!block.color ? 'border-white ring-2 ring-white/40' : 'border-surface-700'}`}
            >×</button>
          </div>
        </Field>

        {(io.reads.length > 0 || io.writes.length > 0) && (
          <div className="flex flex-col gap-1.5 border border-surface-800 rounded p-2">
            {io.reads.length > 0 && (
              <div className="flex items-start gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-surface-500 font-semibold mt-0.5 w-10 shrink-0">{t('Reads')}</span>
                <div className="flex flex-wrap gap-1">{io.reads.map(r => <span key={r} className="text-[10px] font-mono px-1 rounded bg-surface-800 text-surface-300">{r}</span>)}</div>
              </div>
            )}
            {io.writes.length > 0 && (
              <div className="flex items-start gap-1.5">
                <span className="text-[9px] uppercase tracking-wider text-emerald-500 font-semibold mt-0.5 w-10 shrink-0">{t('Writes')}</span>
                <div className="flex flex-wrap gap-1">{io.writes.map(w => <span key={w} className="text-[10px] font-mono px-1 rounded bg-surface-800 text-emerald-300">{w}</span>)}</div>
              </div>
            )}
          </div>
        )}

        {block.type === 'start' && (
          <Field label={t('Flow inputs')} hint={t('Seed variables before the run; override from the CLI/environment.')}>
            <div className="flex flex-col gap-1.5">
              {inputs.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input className={INPUT + ' flex-1'} value={row.key} placeholder={t('name')}
                    onChange={e => setInputs(inputs.map((r, ri) => ri === i ? { ...r, key: e.target.value } : r))} />
                  <input className={INPUT + ' flex-1'} value={row.value} placeholder={t('value')}
                    onChange={e => setInputs(inputs.map((r, ri) => ri === i ? { ...r, value: e.target.value } : r))} />
                  <button onClick={() => setInputs(inputs.filter((_, ri) => ri !== i))}
                    className="text-surface-600 hover:text-red-400 text-sm leading-none px-1" title={t('Remove')}>×</button>
                </div>
              ))}
              <button onClick={() => setInputs([...inputs, { key: '', value: '' }])}
                className="text-[11px] text-blue-400 hover:text-blue-300 text-left">+ {t('Add input')}</button>
            </div>
          </Field>
        )}

        {block.type === 'request' && (
          <p className="text-[11px] text-surface-500">{t('Pick the collection and request directly on the block.')}</p>
        )}
        {block.type === 'subflow' && <SubflowTarget flowId={cfg.flowId} />}

        {block.type === 'if' && (
          <Field label={t('Condition')} hint={t('JS boolean. True routes the `true` port. e.g. sp.response.code === 200')}>
            <textarea rows={3} className={MONO} value={cfg.expression ?? ''} onChange={e => onPatchConfig({ expression: e.target.value })} />
          </Field>
        )}

        {block.type === 'condition' && (
          <Field label={t('Cases')} hint={t('First matching case wins; otherwise the `else` port.')}>
            <div className="flex flex-col gap-2">
              {(cfg.cases ?? []).map((c, i) => (
                <div key={c.id} className="flex flex-col gap-1 border border-surface-800 rounded p-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      className={INPUT + ' flex-1'} value={c.label} placeholder={t('label')}
                      onChange={e => setCases((cfg.cases ?? []).map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                    />
                    <button
                      onClick={() => setCases((cfg.cases ?? []).filter((_, xi) => xi !== i))}
                      className="text-surface-600 hover:text-red-400 text-sm leading-none px-1" title={t('Remove case')}
                    >×</button>
                  </div>
                  <textarea
                    rows={2} className={MONO} value={c.expression} placeholder="sp.response.code < 400"
                    onChange={e => setCases((cfg.cases ?? []).map((x, xi) => xi === i ? { ...x, expression: e.target.value } : x))}
                  />
                </div>
              ))}
              <button
                onClick={() => setCases([...(cfg.cases ?? []), { id: `c${uuidv4().slice(0, 6)}`, label: t('case'), expression: 'true' }])}
                className="text-[11px] text-blue-400 hover:text-blue-300 text-left"
              >+ {t('Add case')}</button>
            </div>
          </Field>
        )}

        {(block.type === 'validate' || block.type === 'evaluate') && (
          <Field
            label={t('Script')}
            hint={block.type === 'validate' ? t('Assert with sp.test(...) / sp.expect(...).') : t('Run JS; set variables with sp.variables.set(...).')}
          >
            <textarea rows={8} className={MONO} value={cfg.script ?? ''} onChange={e => onPatchConfig({ script: e.target.value })} />
          </Field>
        )}

        {block.type === 'setVar' && (
          <>
            <Field label={t('Variable name')}>
              <input className={INPUT} value={cfg.varName ?? ''} placeholder="myVar" onChange={e => onPatchConfig({ varName: e.target.value })} />
            </Field>
            <Field label={t('Scope')}>
              <select className={INPUT} value={cfg.scope ?? 'local'} onChange={e => onPatchConfig({ scope: e.target.value as FlowBlockConfig['scope'] })}>
                <option value="local">{t('Local (this run)')}</option>
                <option value="collection">{t('Collection')}</option>
                <option value="environment">{t('Environment')}</option>
                <option value="global">{t('Global')}</option>
              </select>
            </Field>
            <Field label={t('Value')} hint={t('JS expression, e.g. sp.response.json().token')}>
              <textarea rows={3} className={MONO} value={cfg.valueExpression ?? ''} onChange={e => onPatchConfig({ valueExpression: e.target.value })} />
            </Field>
          </>
        )}

        {block.type === 'delay' && (
          <Field label={t('Delay (ms)')}>
            <input type="number" min={0} step={100} className={INPUT} value={cfg.delayMs ?? 0} onChange={e => onPatchConfig({ delayMs: Math.max(0, Number(e.target.value)) })} />
          </Field>
        )}

        {block.type === 'merge' && (
          <p className="text-[11px] text-surface-500">{t('Continues as soon as any one incoming branch arrives.')}</p>
        )}

        {block.type === 'forEach' && (
          <>
            <Field label={t('List expression')} hint={t('JS returning an array, e.g. sp.response.json().items')}>
              <textarea rows={3} className={MONO} value={cfg.expression ?? ''} onChange={e => onPatchConfig({ expression: e.target.value })} />
            </Field>
            <Field label={t('Item variable')} hint={t('Exposed as data.<name> and {{<name>}} in the body.')}>
              <input className={INPUT} value={cfg.itemVar ?? 'item'} onChange={e => onPatchConfig({ itemVar: e.target.value })} />
            </Field>
            <Field label={t('Index variable')}>
              <input className={INPUT} value={cfg.indexVar ?? 'index'} onChange={e => onPatchConfig({ indexVar: e.target.value })} />
            </Field>
          </>
        )}

        {block.type === 'repeat' && (
          <>
            <Field label={t('Count')}>
              <input type="number" min={0} className={INPUT} value={cfg.count ?? 0} onChange={e => onPatchConfig({ count: Math.max(0, Math.floor(Number(e.target.value))) })} />
            </Field>
            <Field label={t('Index variable')}>
              <input className={INPUT} value={cfg.indexVar ?? 'index'} onChange={e => onPatchConfig({ indexVar: e.target.value })} />
            </Field>
          </>
        )}

        {block.type === 'collect' && (
          <>
            <Field label={t('Into variable')} hint={t('List to append each iteration into; read it after the loop.')}>
              <input className={INPUT} value={cfg.intoVar ?? 'results'} onChange={e => onPatchConfig({ intoVar: e.target.value })} />
            </Field>
            <Field label={t('Value expression')} hint={t('JS value to collect. Defaults to the last response body.')}>
              <textarea rows={2} className={MONO} value={cfg.valueExpression ?? ''} placeholder="sp.response.json()" onChange={e => onPatchConfig({ valueExpression: e.target.value })} />
            </Field>
          </>
        )}

        {block.type === 'display' && (
          <>
            <Field label={t('Value')} hint={t('JS expression (e.g. sp.response.json()) or plain text.')}>
              <textarea rows={3} className={MONO} value={cfg.message ?? ''} onChange={e => onPatchConfig({ message: e.target.value })} />
            </Field>
            <Field label={t('Render as')}>
              <select className={INPUT} value={cfg.as ?? 'json'} onChange={e => onPatchConfig({ as: e.target.value as FlowBlockConfig['as'] })}>
                <option value="json">JSON</option>
                <option value="text">Text</option>
                <option value="table">Table</option>
              </select>
            </Field>
          </>
        )}

        {block.type === 'log' && (
          <Field label={t('Message')} hint={t('JS expression or plain text.')}>
            <textarea rows={3} className={MONO} value={cfg.message ?? ''} onChange={e => onPatchConfig({ message: e.target.value })} />
          </Field>
        )}
      </div>

      {!isStart && (
        <div className="px-4 py-2.5 border-t border-surface-800 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onDuplicate}
            className="flex-1 px-2.5 py-1.5 text-xs text-surface-300 bg-surface-800 hover:bg-surface-700 rounded transition-colors flex items-center justify-center gap-1.5"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path d="M7 3a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V5a2 2 0 00-2-2H7z" /><path d="M3 7a2 2 0 012-2v9a2 2 0 002 2h7a2 2 0 01-2 2H6a3 3 0 01-3-3V7z" /></svg>
            {t('Duplicate')}
          </button>
          <button
            onClick={onDelete}
            className="flex-1 px-2.5 py-1.5 text-xs text-red-300 bg-red-900/30 hover:bg-red-900/50 border border-red-900/40 rounded transition-colors flex items-center justify-center gap-1.5"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            {t('Delete')}
          </button>
        </div>
      )}
    </aside>
  );
}
