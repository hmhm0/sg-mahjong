type MessageHandler = (msg: any) => void;

class GameConnection {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private _connected = false;
  private _playerIndex = -1;
  private _roomCode = '';
  private _serverUrl = '';
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 3;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
  getStoredRoomInfo(): { code: string; playerIndex: number } | null {
    try {
      const code = sessionStorage.getItem('sgmahjong_room_code') || '';
      const idxRaw = sessionStorage.getItem('sgmahjong_player_index');
      const playerIndex = idxRaw === null ? -1 : Number(idxRaw);
      if (!code || !Number.isInteger(playerIndex) || playerIndex < 0) return null;
      return { code, playerIndex };
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
      this.ws = new WebSocket(this._serverUrl);
      this.installExitHooks();

      this.ws.onopen = () => {
        this._connected = true;
        this._reconnectAttempts = 0;
        this.dispatch({ type: 'connected' });
        if (this._roomCode && this._playerIndex >= 0) {
          this.send({
            type: 'rejoin_room',
            code: this._roomCode,
            playerIndex: this._playerIndex,
          });
        }
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.dispatch(msg);
        } catch (e) {
          console.error('Invalid message:', e);
        }
      };

      this.ws.onclose = () => {
        this._connected = false;
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

      this.ws.onerror = (err) => {
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

  setRoomInfo(code: string, index: number) {
    this._roomCode = code;
    this._playerIndex = index;
    try {
      sessionStorage.setItem('sgmahjong_room_code', code);
      sessionStorage.setItem('sgmahjong_player_index', String(index));
    } catch {
      // ignore storage failures
    }
  }

  disconnect() {
    this._manualDisconnect = true;
    this.cancelReconnect();
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      this.ws = null;
      this._connected = false;
    } else if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this._exitHooksInstalled && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this._leaveRoomOnExit);
      window.removeEventListener('beforeunload', this._leaveRoomOnExit);
    }
    this._connected = false;
    this._playerIndex = -1;
    this._roomCode = '';
    this.handlers.clear();
    try {
      sessionStorage.removeItem('sgmahjong_room_code');
      sessionStorage.removeItem('sgmahjong_player_index');
    } catch {
      // ignore storage failures
    }
    this._exitHooksInstalled = false;
  }

  clearRoomInfo() {
    this._roomCode = '';
    this._playerIndex = -1;
    try {
      sessionStorage.removeItem('sgmahjong_room_code');
      sessionStorage.removeItem('sgmahjong_player_index');
    } catch {
      // ignore storage failures
    }
  }
}

export const connection = new GameConnection();
export const SERVER_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:3002`;
