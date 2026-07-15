import { MultiplayerStateRevisionGate } from './multiplayerState';

type MessageHandler = (msg: any) => void;

class GameConnection {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private _connected = false;
  private _playerIndex = -1;
  private _roomCode = '';
  private _reconnectToken = '';
  private _serverUrl = '';
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 3;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingActionTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingAction: { id: string; actionType: string; sentAt: number } | null = null;
  private _actionSequence = 0;
  private _revisionGate = new MultiplayerStateRevisionGate();
  private _manualDisconnect = false;
  private _exitHooksInstalled = false;
  private _leaveRoomOnExit = () => {
    if (!this._roomCode || this._manualDisconnect || this._playerIndex === 0) return;
    try {
      this.send({ type: 'leave_room' });
    } catch {
      // ignore exit-time send failures
    }
  };

  get connected() { return this._connected; }
  get playerIndex() { return this._playerIndex; }
  get roomCode() { return this._roomCode; }
  get reconnectToken() { return this._reconnectToken; }
  getStoredRoomInfo(): { code: string; playerIndex: number; reconnectToken: string } | null {
    try {
      const code = sessionStorage.getItem('sgmahjong_room_code') || '';
      const idxRaw = sessionStorage.getItem('sgmahjong_player_index');
      const reconnectToken = sessionStorage.getItem('sgmahjong_reconnect_token') || '';
      const playerIndex = idxRaw === null ? -1 : Number(idxRaw);
      if (!code || !reconnectToken || !Number.isInteger(playerIndex) || playerIndex < 0) return null;
      return { code, playerIndex, reconnectToken };
    } catch {
      return null;
    }
  }

  connect(url: string): Promise<void> {
    this._serverUrl = url;
    this._manualDisconnect = false;
    this._reconnectAttempts = 0;
    return this._doConnect();
  }

  private _doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this._serverUrl);
      this.ws = socket;
      this.installExitHooks();

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this._connected = true;
        this._reconnectAttempts = 0;
        this.dispatch({ type: 'connected' });
        if (this._roomCode && this._playerIndex >= 0) {
          this._revisionGate.reset(this._roomCode);
          this.send({
            type: 'rejoin_room',
            code: this._roomCode,
            playerIndex: this._playerIndex,
            reconnectToken: this._reconnectToken,
          });
        }
        resolve();
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket || this._manualDisconnect) return;
        try {
          const msg = JSON.parse(event.data);
          this.processActionAcknowledgements(msg);
          this.dispatch(msg);
        } catch (e) {
          console.error('Invalid message:', e);
        }
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this._connected = false;
        this.clearPendingAction('disconnected');
        this.dispatch({ type: 'disconnected' });
        if (this._manualDisconnect) return;
        // Auto-reconnect with backoff
        if (this._roomCode && this._reconnectAttempts < this._maxReconnectAttempts) {
          this._reconnectAttempts++;
          this.dispatch({
            type: 'reconnecting',
            attempt: this._reconnectAttempts,
            maxAttempts: this._maxReconnectAttempts,
          });
          this._reconnectTimer = setTimeout(() => {
            this._doConnect();
          }, 2000 * this._reconnectAttempts);
        }
      };

      socket.onerror = (err) => {
        if (this.ws !== socket) return;
        if (this._reconnectAttempts === 0) reject(err);
      };
    });
  }

  private installExitHooks() {
    if (this._exitHooksInstalled || typeof window === 'undefined') return;
    this._exitHooksInstalled = true;
    window.addEventListener('pagehide', this._leaveRoomOnExit);
    window.addEventListener('beforeunload', this._leaveRoomOnExit);
  }
  
  cancelReconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectAttempts = this._maxReconnectAttempts;
  }

  markRoomClosed() {
    this._manualDisconnect = true;
    this.cancelReconnect();
  }

  send(msg: any) {
    if (this.ws && this._connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendGameAction(actionType: string, data?: Record<string, unknown>): boolean {
    if (!this.ws || !this._connected || this.ws.readyState !== WebSocket.OPEN || this._pendingAction) {
      return false;
    }
    const clientActionId = `${Date.now().toString(36)}-${(++this._actionSequence).toString(36)}`;
    const sentAt = performance.now();
    this._pendingAction = { id: clientActionId, actionType, sentAt };
    this.dispatch({ type: 'action_pending', actionType, clientActionId });
    this.ws.send(JSON.stringify({
      type: 'action',
      actionType,
      clientActionId,
      data: data || {},
    }));
    this._pendingActionTimer = setTimeout(() => {
      if (this._pendingAction?.id !== clientActionId) return;
      this.clearPendingAction('timeout');
    }, 8000);
    return true;
  }

  shouldApplyStateUpdate(message: any): boolean {
    return this._revisionGate.shouldApply(this._roomCode, message?.revision);
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private dispatch(msg: any) {
    const handlers = this.handlers.get(msg.type);
    if (handlers) {
      handlers.forEach(h => h(msg));
    }
    // Also dispatch to wildcard handler
    const wildcard = this.handlers.get('*');
    if (wildcard) {
      wildcard.forEach(h => h(msg));
    }
  }

  private processActionAcknowledgements(message: any) {
    if (message?.type === 'error' && message.clientActionId && this._pendingAction?.id === message.clientActionId) {
      this.clearPendingAction('rejected');
      return;
    }
    if (message?.type !== 'state_update' || !Array.isArray(message.actionAcks) || !this._pendingAction) {
      return;
    }
    const acknowledgement = message.actionAcks.find((ack: any) =>
      ack?.clientActionId === this._pendingAction?.id &&
      ack?.playerIndex === this._playerIndex
    );
    if (!acknowledgement) return;
    const pending = this._pendingAction;
    const latencyMs = Math.max(0, performance.now() - pending.sentAt);
    this.clearPendingAction(null);
    this.dispatch({
      type: 'action_acknowledged',
      actionType: pending.actionType,
      clientActionId: pending.id,
      latencyMs,
    });
  }

  private clearPendingAction(reason: string | null) {
    if (this._pendingActionTimer) {
      clearTimeout(this._pendingActionTimer);
      this._pendingActionTimer = null;
    }
    const pending = this._pendingAction;
    this._pendingAction = null;
    if (pending && reason) {
      this.dispatch({
        type: 'action_cleared',
        actionType: pending.actionType,
        clientActionId: pending.id,
        reason,
      });
    }
  }

  setRoomInfo(code: string, index: number, reconnectToken?: string) {
    if (code !== this._roomCode) {
      this._revisionGate.reset(code);
    }
    this._roomCode = code;
    this._playerIndex = index;
    if (reconnectToken) this._reconnectToken = reconnectToken;
    try {
      sessionStorage.setItem('sgmahjong_room_code', code);
      sessionStorage.setItem('sgmahjong_player_index', String(index));
      if (this._reconnectToken) {
        sessionStorage.setItem('sgmahjong_reconnect_token', this._reconnectToken);
      }
    } catch {
      // ignore storage failures
    }
  }

  disconnect() {
    this._manualDisconnect = true;
    this.cancelReconnect();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        socket.onopen = () => {
          try {
            socket.close();
          } catch {
            // ignore a socket that never completed connecting
          }
        };
      }
    }
    if (this._exitHooksInstalled && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this._leaveRoomOnExit);
      window.removeEventListener('beforeunload', this._leaveRoomOnExit);
    }
    this._connected = false;
    this.clearPendingAction('disconnected');
    this._playerIndex = -1;
    this._roomCode = '';
    this._reconnectToken = '';
    this._revisionGate.reset();
    try {
      sessionStorage.removeItem('sgmahjong_room_code');
      sessionStorage.removeItem('sgmahjong_player_index');
      sessionStorage.removeItem('sgmahjong_reconnect_token');
    } catch {
      // ignore storage failures
    }
    this._exitHooksInstalled = false;
  }

  clearRoomInfo() {
    this._roomCode = '';
    this._playerIndex = -1;
    this._reconnectToken = '';
    this.clearPendingAction('room_cleared');
    this._revisionGate.reset();
    try {
      sessionStorage.removeItem('sgmahjong_room_code');
      sessionStorage.removeItem('sgmahjong_player_index');
      sessionStorage.removeItem('sgmahjong_reconnect_token');
    } catch {
      // ignore storage failures
    }
  }
}

export const connection = new GameConnection();
export const SERVER_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:3002`;
