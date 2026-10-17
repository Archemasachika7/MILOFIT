/**
 * WebSocket client: connection lifecycle, reconnection, ping measurement and
 * fan-out of server messages to plain callbacks.
 */
export const C2S = {
  HELLO: 'hello',
  JOIN: 'join',
  INPUT: 'input',
  CHAT: 'chat',
  TEAM: 'team',
  SETTINGS: 'settings',
  START: 'start',
  PING: 'ping',
};

export class GameClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.handlers = {};
    this.status = 'idle';
    this.rtt = 0;
    this.you = null;
    this.room = null;
    this.roster = null;
    this.welcome = null;
    this.joinOptions = null;
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this._pingTimer = null;
    this._pendingPing = 0;
  }

  on(name, handler) {
    (this.handlers[name] ??= []).push(handler);
    return this;
  }

  emit(name, payload) {
    for (const handler of this.handlers[name] ?? []) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`handler "${name}" failed`, err);
      }
    }
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  connect(url = this.url) {
    this.url = url;
    this.manualClose = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      this.socket = socket;
      this.setStatus('connecting');

      const failTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* ignore */ }
        reject(new Error('connection timed out'));
      }, 8000);

      socket.onopen = () => {
        clearTimeout(failTimer);
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startPinging();
        if (!settled) {
          settled = true;
          resolve(this);
        }
        this.emit('open');
        if (this.joinOptions) this.join(this.joinOptions);
      };

      socket.onmessage = (event) => this.handleMessage(event.data);

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(failTimer);
          reject(new Error('connection failed'));
        }
      };

      socket.onclose = (event) => {
        clearTimeout(failTimer);
        this.stopPinging();
        this.setStatus(this.manualClose ? 'closed' : 'disconnected');
        this.emit('close', event);
        if (!settled) {
          settled = true;
          reject(new Error('connection closed'));
          return;
        }
        if (!this.manualClose) this.scheduleReconnect();
      };
    });
  }

  scheduleReconnect() {
    this.reconnectAttempts += 1;
    const delay = Math.min(8000, 600 * this.reconnectAttempts);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    setTimeout(() => {
      if (this.manualClose) return;
      this.connect(this.url).catch(() => { /* retried by onclose */ });
    }, delay);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  startPinging() {
    this.stopPinging();
    this._pingTimer = setInterval(() => {
      this._pendingPing = performance.now();
      this.send({ t: C2S.PING, ts: this._pendingPing });
    }, 1000);
  }

  stopPinging() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  join(options) {
    this.joinOptions = options;
    this.send({
      t: C2S.JOIN,
      name: options.name,
      character: options.character,
      role: options.role,
      room: options.room,
      team: options.team,
      map: options.map,
      mode: options.mode,
      format: options.format,
      roleMode: options.roleMode,
      gravityMode: options.gravityMode,
    });
  }

  sendInput(frame, seq) {
    this.send({
      t: C2S.INPUT,
      x: Number(frame.x.toFixed(3)),
      jump: !!frame.jump,
      jet: !!frame.jet,
      fire: !!frame.fire,
      aim: { x: Math.round(frame.aim.x), y: Math.round(frame.aim.y) },
      actions: frame.actions,
      seq,
      rtt: Math.round(this.rtt),
    });
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'welcome':
        this.welcome = msg;
        if (msg.you) this.you = msg.you;
        if (msg.room) this.room = msg.room;
        this.emit('welcome', msg);
        if (msg.roster) this.emit('roster', msg.roster);
        break;
      case 'room':
        this.room = msg.room;
        this.emit('room', msg.room);
        break;
      case 'roster':
        this.roster = msg.roster;
        this.emit('roster', msg.roster);
        break;
      case 'state':
        this.emit('state', msg);
        break;
      case 'events':
        this.emit('events', msg.events ?? []);
        break;
      case 'chat':
        this.emit('chat', msg);
        break;
      case 'pong':
        if (msg.ts != null) {
          const sample = performance.now() - msg.ts;
          this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
        }
        this.emit('pong', msg);
        break;
      case 'error':
        this.emit('serverError', msg);
        break;
      default:
        break;
    }
  }

  close() {
    this.manualClose = true;
    this.stopPinging();
    try {
      this.socket?.close();
    } catch { /* ignore */ }
    this.setStatus('closed');
  }
}
