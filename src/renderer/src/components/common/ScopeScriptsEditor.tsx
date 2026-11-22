// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cmLabel } from '../../lib/cmA11y';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { atCompletionExtension, varHoverTooltipExtension, signatureHelpExtension } from '../RequestBuilder/atCompletions';
import { useVarNames } from '../../hooks/useVarNames';
import { useVarValues } from '../../hooks/useVarValues';
import { useT } from '../../i18n';

interface Props {
  readonly pre: string
  readonly post: string
  readonly onChange: (patch: { preRequestScript?: string; postRequestScript?: string }) => void
}

// Pre/post-request script editor for a collection or folder. These scripts run
// around every request in scope, wrapping the request's own scripts (see
// resolveInheritedScripts). A lean cousin of the request ScriptsTab: same
// CodeMirror + @var/faker autocomplete, without the app-tab/library plumbing.
export function ScopeScriptsEditor({ pre, post, onChange }: Props) {
  const t = useT();
  const [scriptType, setScriptType] = useState<'pre' | 'post'>('pre');
  const varNames  = useVarNames();
  const varValues = useVarValues();
  const extensions = useMemo(
    () => [javascript({ typescript: true }), atCompletionExtension(varNames, []), signatureHelpExtension([]), varHoverTooltipExtension(varValues)],
    [varNames, varValues],
  );

  const value = scriptType === 'pre' ? pre : post;
  const handleChange = (code: string) =>
    onChange(scriptType === 'pre' ? { preRequestScript: code } : { postRequestScript: code });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-0 border-b border-surface-700">
        {(['pre', 'post'] as const).map(st => (
          <button
            key={st}
            onClick={() => setScriptType(st)}
            className={`px-3 py-1 text-xs border-b-2 -mb-px transition-colors ${
              scriptType === st ? 'border-blue-500 text-white' : 'border-transparent text-surface-400 hover:text-white'
            }`}
          >
            {st === 'pre' ? t('Pre-request') : t('Post-response')}
          </button>
        ))}
      </div>

      <div className="text-[10px] text-surface-400">
        {scriptType === 'pre'
          ? t("Runs before each request in this scope, ahead of the request's own pre-request script. Handy for shared setup, e.g. sp.environment.set('requestId', '{{faker.string.uuid()}}').")
          : t("Runs after each request in this scope, after the request's own post-request script. Use sp.test() for shared assertions.")}
      </div>

      <div className="rounded border border-surface-700">
        <CodeMirror
          value={value}
          height="45vh"
          theme={oneDark}
          extensions={[...extensions, ...cmLabel(t('Script editor'))]}
          onChange={handleChange}
          basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
        />
      </div>
    </div>
  );
}
