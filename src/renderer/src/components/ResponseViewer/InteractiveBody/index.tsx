// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import React, { useState } from 'react';
import type { JsonPath } from './utils/jsonPath';
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
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const isJson = contentType.includes('json');
  const isXml  = !isJson && (contentType.includes('xml') || contentType.includes('html'));

  let parsedJson: unknown = null;
  if (isJson) {
    try { parsedJson = JSON.parse(body); } catch { /* handled below */ }
  }

  function handleJsonLeaf(e: React.MouseEvent, path: JsonPath, value: unknown) {
    e.stopPropagation();
    setPopover({ type: 'json', path, value, root: parsedJson, x: e.clientX + 10, y: e.clientY + 10 });
  }

  function handleXmlLeaf(e: React.MouseEvent, selector: string, value: string) {
    e.stopPropagation();
    setPopover({ type: 'xml', selector, value, x: e.clientX + 10, y: e.clientY + 10 });
  }

  const treeContent = isJson ? (() => {
    if (parsedJson === null) {
      return <div className="p-4 text-xs text-surface-600">Unable to parse JSON response body</div>;
    }
    return <JsonNode nodeKey={null} value={parsedJson} path={[]} depth={0} onLeaf={handleJsonLeaf} />;
  })() : isXml ? (() => {
    const doc = new DOMParser().parseFromString(body, 'text/xml');
    const root = doc.documentElement;
    if (root.tagName === 'parsererror') {
      return <div className="p-4 text-xs text-surface-600">Unable to parse XML response body</div>;
    }
    return <XmlNode element={root} depth={0} onLeaf={handleXmlLeaf} />;
  })() : (
    <div className="p-4 text-xs text-surface-600">Interactive tree not available for this content type. Use Raw view.</div>
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
