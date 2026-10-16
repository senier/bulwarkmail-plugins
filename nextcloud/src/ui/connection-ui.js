// The connection state and what the user sees about it, shared by every slot.

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, EmptyState, Loading, Row, Section, SettingRow, Spinner, Stack, Text,
} from '@plugin-host/ui';
import { adminBase, adminServer, approveServer, disconnect, getConnection, pollLoginFlow, resolveBase, startLoginFlow } from '../lib/connection.js';
import { NcError, errorText, needsSignIn } from '../lib/errors.js';
import { hostOf } from '../lib/format.js';
import { connectedText } from '../lib/account.js';

/**
 * status: loading | disconnected | approving | waiting | connected | expired | error
 */
export function useConnection(api) {
  const [state, setState] = useState({ status: 'loading' });
  const flowRef = useRef(null);
  const mounted = useRef(true);

  const set = (next) => { if (mounted.current) setState(next); };

  const refresh = useCallback(async () => {
    let fixed = null;
    try {
      fixed = await adminServer(api);
      const conn = await getConnection(api, { fixedServer: fixed });
      set(conn ? { status: 'connected', conn, fixed } : { status: 'disconnected', fixed });
      return conn;
    } catch (err) {
      if (err instanceof NcError && err.code === 'wrong_server') set({ status: 'disconnected', fixed, error: err });
      else if (needsSignIn(err)) set({ status: 'expired', fixed, error: err });
      else set({ status: 'error', fixed, error: err });
      return null;
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      flowRef.current?.abort();
    };
  }, [refresh]);

  const connect = useCallback(async ({ suggestedServer } = {}) => {
    const fixed = await adminServer(api);
    set({ status: 'approving', fixed });
    const controller = new AbortController();
    flowRef.current?.abort();
    flowRef.current = controller;
    try {
      const origin = await approveServer(api, { fixedServer: fixed, suggestedServer: suggestedServer ?? state.conn?.origin });
      if (!origin) { await refresh(); return null; }
      const flow = await startLoginFlow(api, resolveBase(origin, await adminBase(api)));
      set({ status: 'waiting', fixed, origin, loginUrl: flow.loginUrl });
      await api.ui.openExternalUrl(flow.loginUrl).catch(() => {});
      await pollLoginFlow(api, flow, { signal: controller.signal });
      const conn = await refresh();
      if (conn) api.toast.success(api.i18n.t('connect.done', { host: hostOf(conn.origin) }));
      return conn;
    } catch (err) {
      if (err instanceof NcError && err.code === 'cancelled') { await refresh(); return null; }
      set({ status: 'error', fixed, error: err });
      return null;
    } finally {
      if (flowRef.current === controller) flowRef.current = null;
    }
  }, [api, refresh, state.conn]);

  const cancel = useCallback(() => { flowRef.current?.abort(); }, []);

  const signOut = useCallback(async () => {
    try {
      await disconnect(api);
    } catch (err) {
      api.toast.error(errorText(api.i18n.t, err));
    }
    await refresh();
  }, [api, refresh]);

  /** Disconnect this account and sign in again, so another Nextcloud account can be chosen. */
  const switchAccount = useCallback(async () => {
    const origin = state.conn?.origin;
    try {
      await disconnect(api);
    } catch (err) {
      api.toast.error(errorText(api.i18n.t, err));
      return null;
    }
    return connect({ suggestedServer: origin });
  }, [api, connect, state.conn]);

  /** Call with any error from a Nextcloud request: switches to "expired" when the password stopped working. */
  const report = useCallback((err) => {
    if (needsSignIn(err)) set({ status: 'expired', fixed: state.fixed, error: err });
  }, [state.fixed]);

  return { ...state, refresh, connect, cancel, signOut, switchAccount, report };
}

/** Title and text for a connection that isn't usable (yet). */
export function connectionMessage(t, c) {
  const fixedHost = c.fixed ? hostOf(c.fixed) : '';
  if (c.status === 'loading') return { icon: 'cloud', title: t('connect.checking') };
  if (c.status === 'approving') return { icon: 'cloud', title: t('connect.approving') };
  if (c.status === 'waiting') return { icon: 'external-link', title: t('composer.waiting'), text: t('connect.waiting', { host: hostOf(c.origin) }) };
  if (c.status === 'expired') return { icon: 'lock', title: t('connect.expiredTitle'), text: t('connect.expired') };
  if (c.status === 'error') return { icon: 'alert-triangle', title: t('error.unknown'), text: errorText(t, c.error) };
  const intro = c.error?.code === 'wrong_server' ? t('error.wrong_server_host', { host: fixedHost }) : t('connect.intro');
  return { icon: 'cloud', title: t('connect.title'), text: fixedHost ? `${intro} ${t('connect.server', { host: fixedHost })}` : intro };
}

/** The main button for a connection that isn't usable, or null. */
export function connectLabel(t, c) {
  if (c.status === 'disconnected' || c.status === 'error') return t('connect.button');
  if (c.status === 'expired') return t('connect.again');
  return null;
}

/**
 * The not-connected states as the Files app's empty state, for the page
 * and dialog bodies. With `actions: false` the buttons go elsewhere (a
 * dialog's footer).
 */
export function ConnectionEmpty({ api, connection, actions = true, compact = false }) {
  const t = api.i18n.t;
  const c = connection;
  if (c.status === 'loading') return h(Loading, { label: t('connect.checking') });
  const m = connectionMessage(t, c);
  let buttons = null;
  if (actions && c.status === 'waiting') {
    buttons = [
      h(Button, { key: 'reopen', variant: 'secondary', icon: 'external-link', onClick: () => void api.ui.openExternalUrl(c.loginUrl) }, t('connect.reopen')),
      h(Button, { key: 'cancel', variant: 'ghost', onClick: c.cancel }, t('common.cancel')),
    ];
  } else if (actions && connectLabel(t, c)) {
    buttons = h(Button, { icon: 'cloud', onClick: () => void c.connect() }, connectLabel(t, c));
  }
  return h(EmptyState, { icon: m.icon, title: m.title, description: m.text, actions: buttons, compact });
}

/** The account as Settings shows it: Section and SettingRows, like the app's settings. */
export function ConnectionSettings({ api, connection }) {
  const t = api.i18n.t;
  const c = connection;
  let row;
  if (c.status === 'connected') {
    row = h(SettingRow, { label: connectedText(t, c.conn), description: t('connect.accountHint') },
      h(Row, { gap: 2 },
        h(Button, { variant: 'secondary', onClick: () => void c.switchAccount() }, t('connect.switch')),
        h(Button, { variant: 'secondary', onClick: () => void c.signOut() }, t('connect.disconnect'))));
  } else if (c.status === 'loading' || c.status === 'approving') {
    row = h(SettingRow, { label: connectionMessage(t, c).title }, h(Spinner, {}));
  } else if (c.status === 'waiting') {
    const m = connectionMessage(t, c);
    row = h(SettingRow, { label: m.title, description: m.text },
      h(Row, { gap: 2 },
        h(Button, { variant: 'secondary', onClick: () => void api.ui.openExternalUrl(c.loginUrl) }, t('connect.reopen')),
        h(Button, { variant: 'ghost', onClick: c.cancel }, t('common.cancel'))));
  } else {
    const m = connectionMessage(t, c);
    row = h(SettingRow, { label: m.title, description: m.text },
      h(Button, { onClick: () => void c.connect() }, connectLabel(t, c)));
  }
  return h(Stack, { gap: 4 },
    h(Section, { title: t('settings.title'), description: t('settings.privacy') }, row),
    h(Text, { tone: 'muted', size: 'xs' }, t('settings.migration')));
}
