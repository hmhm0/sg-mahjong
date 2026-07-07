type MessageHandler = (msg: any) => void;

class GameConnection {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private _connected = false;
  private _playerIndex = -1;
  private _roomCode = '';

  get connected() { return this._connected; }
  get playerIndex() { return this._playerIndex; }
  get roomCode() { return this._roomCode; }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this._connected = true;
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
      };

      this.ws.onerror = (err) => {
        reject(err);
      };
    });
  }

  send(msg: any) {
    if (this.ws && this._connected) {
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
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this._playerIndex = -1;
    this._roomCode = '';
    this.handlers.clear();
  }
}

export const connection = new GameConnection();
export const SERVER_URL = `ws://${window.location.hostname}:3001`;
