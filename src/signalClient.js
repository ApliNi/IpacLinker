import EventEmitter from 'events';
import { sleep } from './util.js';
import io from 'socket.io-client';
import { Logger } from './logger.js';
import { config } from '../index.js';

export default class SignalClient extends EventEmitter {
	constructor(logger = new Logger()) {
		super();
		this.logger = logger;
		this.socket = null;
		this.connected = false;
		this.connectToServer();
	}

	connectToServer() {
		this.logger.info('[SignalClient] 正在连接服务器...');
		this.socket = io.connect(config.SignalServer, {
			transports: ['websocket']
		});

		this.socket.on('connect', () => {
			this.logger.info('[SignalClient] 连接成功');
			this.connected = true;
			this.emit('connect');
		});

		this.socket.on('msg', (data) => {
			this.logger.debug(`[SignalClient] [MSG] ${JSON.stringify(data)}`);
			this.emit('msg', data);
		});

		this.socket.on('error', (err) => {
			this.logger.error(`[SignalClient] Error: ${err}`);
			this.emit('error', err);
		});

		this.socket.on('disconnect', (reason) => {
			this.logger.info(`[SignalClient] 连接断开: ${reason}`);
			this.connected = false;
			this.emit('close', reason);
		});
	}

	async server_register(data) {
		while (!this.connected) {
			this.logger.info(`[SignalClient] 等待重新建立连接`);
			await sleep(1000); // Wait for 1s
		}
		this._sendData('ServerReg', data);
	}

	async client_register(data) {
		while (!this.connected) {
			this.logger.info(`[SignalClient] 等待重新建立连接`);
			await sleep(1000); // Wait for 1s
		}
		this._sendData('ClientReg', data);
	}

	client_send_signal(dataObj) {
		this.logger.debug(`[SignalClient] [SEND] ${JSON.stringify(dataObj)}`);
		this._sendData('ClientSendSignal', dataObj);
	}

	server_send_signal(dataObj) {
		this._sendData('ServerSendSignal', dataObj);
	}

	_sendData(eventType, data) {
		if (this.connected) {
			this.socket.emit(eventType, data);
		} else {
			this.logger.error(`[SignalClient] 无法发送事件 "${eventType}" 的数据: Socket 未连接`);
		}
	}

	close() {
		if (this.socket) {
			this.socket.close();
			this.socket = null;
			this.connected = false;
		}
	}
};
