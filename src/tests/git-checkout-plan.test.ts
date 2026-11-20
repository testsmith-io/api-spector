// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Checkout must decide local-vs-remote against the real local-branch list, not a
// '/' in the name: slashed local branches (feat/…, fix/…) must switch, not spawn
// a wrongly-named duplicate tracking branch.
import { describe, it, expect } from 'vitest';
import { planCheckout } from '../main/git-checkout-plan';

const LOCALS = ['main', 'feat/open-from-git', 'fix/bug-123'];

describe('planCheckout', () => {
  it('switches to a slashed local branch instead of creating a duplicate', () => {
    // The regression: used to run `checkout -b open-from-git feat/open-from-git`.
    expect(planCheckout('feat/open-from-git', LOCALS)).toEqual({ kind: 'switch', name: 'feat/open-from-git' });
  });

  it('switches to a plain local branch', () => {
    expect(planCheckout('main', LOCALS)).toEqual({ kind: 'switch', name: 'main' });
  });

  it('creates a tracking branch for a remote ref with no local counterpart', () => {
    expect(planCheckout('origin/release-9', LOCALS))
      .toEqual({ kind: 'track', name: 'release-9', startPoint: 'origin/release-9' });
  });

  it('creates a tracking branch for a slashed remote ref', () => {
    expect(planCheckout('origin/feat/new-thing', LOCALS))
      .toEqual({ kind: 'track', name: 'feat/new-thing', startPoint: 'origin/feat/new-thing' });
  });

  it('switches to the existing local branch rather than detaching on origin/<name>', () => {
    // Clicking origin/main while a local main exists must land on local main,
    // never a detached checkout of the remote-tracking ref.
    expect(planCheckout('origin/main', LOCALS)).toEqual({ kind: 'switch', name: 'main' });
  });

  it('switches to a local branch that matches a slashed remote ref', () => {
    expect(planCheckout('origin/feat/open-from-git', LOCALS))
      .toEqual({ kind: 'switch', name: 'feat/open-from-git' });
  });

  it('passes a bare ref (tag or SHA) through to a plain checkout', () => {
    expect(planCheckout('v1.2.0', LOCALS)).toEqual({ kind: 'switch', name: 'v1.2.0' });
    expect(planCheckout('9a1b2c3', LOCALS)).toEqual({ kind: 'switch', name: '9a1b2c3' });
  });
});
