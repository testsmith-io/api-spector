// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState, useMemo, useCallback } from 'react';
import { useT } from '../../../i18n';
import type { JsonPath } from './utils/jsonPath';

// Stable empty root path so the memoized root JsonNode isn't handed a fresh
// array on every render.
const ROOT_PATH: JsonPath = [];
import type { PopoverState } from './types';
import { JsonNode } from './JsonNode';
import { XmlNode } from './XmlNode';
import { AssertMenu } from './AssertMenu';

interface Props {
  body: string
  contentType: string
  onAssert: (snippet: string) => void
}

export function InteractiveBody({ body, contentType, onAssert }: Props) {
  const t = useT();
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const isJson = contentType.includes('json');
  const isXml  = !isJson && (contentType.includes('xml') || contentType.includes('html'));

  // Parse once per body (was re-parsed every render, plus again per render in
  // handleJsonLeaf's closure), keeping the value referentially stable so the
  // memoized JsonNode tree doesn't re-render on unrelated parent updates.
  const parsedJson = useMemo<unknown>(() => {
    if (!isJson) return null;
    try { return JSON.parse(body); } catch { return null; }
  }, [body, isJson]);

  const handleJsonLeaf = useCallback((e: React.MouseEvent, path: JsonPath, value: unknown) => {
    e.stopPropagation();
    setPopover({ type: 'json', path, value, root: parsedJson, x: e.clientX + 10, y: e.clientY + 10 });
  }, [parsedJson]);

  function handleXmlLeaf(e: React.MouseEvent, selector: string, value: string) {
    e.stopPropagation();
    setPopover({ type: 'xml', selector, value, x: e.clientX + 10, y: e.clientY + 10 });
  }

  const treeContent = isJson ? (() => {
    if (parsedJson === null) {
      return <div className="p-4 text-xs text-surface-600">{t('Unable to parse JSON response body')}</div>;
    }
    return <JsonNode nodeKey={null} value={parsedJson} path={ROOT_PATH} depth={0} onLeaf={handleJsonLeaf} />;
  })() : isXml ? (() => {
    const doc = new DOMParser().parseFromString(body, 'text/xml');
    const root = doc.documentElement;
    if (root.tagName === 'parsererror') {
      return <div className="p-4 text-xs text-surface-600">{t('Unable to parse XML response body')}</div>;
    }
    return <XmlNode element={root} depth={0} onLeaf={handleXmlLeaf} />;
  })() : (
    <div className="p-4 text-xs text-surface-600">{t('Interactive tree not available for this content type. Use Raw view.')}</div>
  );

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 font-mono">
      {popover && (
        <AssertMenu
          state={popover}
          onClose={() => setPopover(null)}
          onConfirm={snippet => { onAssert(snippet); setPopover(null); }}
        />
      )}
      {treeContent}
    </div>
  );
}
