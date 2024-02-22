import { createServer } from 'net';
import SignalClient from './signalClient.js';
import WebRTC from './webRTC.js';
import { config } from '../index.js';

export default class MappingClient {

	constructor(li = {server, port, uuid}, logger){
		this.server = li.server;
		this.port = li.port;
		this.uuid = li.uuid;
		this.logger = logger;

		this.channel = 0;
		this.peer_connected = false;
		this.peerOffer = undefined;
		this.subClientDict = {};
		this.client_registered = false;
	}

	listenLocalPort() {
		this.net = createServer();
		this.net.listen(this.port, '127.0.0.1', () => {
			// this.logger.info(`[NET] 正在监听本地端口: ${this.port}`);
		});

		this.net.on('connection', (c) => {
			let channel = `#${++this.channel}`;
			this.logger.info(`[NET] <-> Channel[${channel}]`);
			this.logger.debug(`[NET] peer_connected: ${this.peer_connected}`);
			if(this.peer_connected){
				this.setupClientSocket(c, channel);
			}else{
				this.logger.error('[NET] Peer 尚未完成连接');
				c.end();
			}
		});

		this.net.on('error', (err) => {
			const msg = err.toString();
			if(msg.includes('Error: listen EADDRINUSE: address already in use')){
				this.logger.error(`[NET] 本地端口 ${this.port} 已被占用`);
				process.exit();
			}
			this.logger.error();
		});
	}

	setupClientSocket(c, channel) {
		c.on('data', (data) => {
			if (this.peer_connected) {
				this.peerOffer.sendBuf(data, channel);
			} else {
				this.logger.error(`Peer 未连接, 关闭通道的本地 Socket: Channel[${channel}]`);
				c.end();
			}
		});

		c.on('error', (e) => {
			this.logger.error(`本地 Socket 错误: ${e}`);
		});

		c.on('end', () => {
			// Client disconnected
		});

		c.on('close', (err) => {
			if(err){
				this.logger.error(`关闭本地 Socket 时出现错误: Channel[${channel}], Error: ${err}`);
			}
			this.logger.info(`本地 Socket 已关闭: Channel[${channel}]`);
			if(this.peerOffer){
				this.peerOffer.closeDataChannel(channel);
			}
			delete this.subClientDict[channel];
		});

		this.peerOffer.createDataChannel(channel);
		this.subClientDict[channel] = { subClientSocket: c, channel };
	}

	client_register() {
		this.listenLocalPort();
		this.signalClient = new SignalClient(this.logger);

		this.signalClient.on('close', () => {
			this.logger.info('Signal 服务器已断开连接');
			this.client_registered = false;
		});

		this.signalClient.on('connect', () => {
			this.logger.info('正在准备点对点连接...');
			this.signalClient.client_register({
				version: 0.1,
				server: this.server,
				uuid: this.uuid
			});
		});

		this.signalClient.on('msg', (msgObj) => {
			let { type, data } = msgObj;

			switch (type) {
				case 'client_registered':
					if(!data.success){
						logger.error(`注册失败: ${data}`);
						return;
					}
					this.logger.debug(`客户端已注册`);
					this.client_registered = true;
					break;
				case 'errMsg':
					this.logger.error(JSON.stringify(data));
					break;
				case 'serverSignal':
					this.handleServerSignal(data);
					break;
				// Add other cases as needed
			}
		});
	}

	handleServerSignal(data) {
		let { event, server, uuid, channel, buf } = data;
		// this.logger.info(`channel: ${channel}, event: ${event}, buf: ${buf}`);

		switch (event) {
			case 'server_signal_description':
				this.peerOffer.setRemoteDescription(buf);
				break;
			case 'server_signal_candidate':
				this.peerOffer.addRemoteCandidate(buf);
				break;
			case 'errMsg':
				this.logger.error(JSON.stringify(data));
				break;
			case 'serverMsg':
				// 服务器自定义消息
				this.logger.mark(`[服务器]: ${buf}`);
				break;
			case 'remoteServer_connected':
				// Handle remote server connected event
				break;
			case 'remoteServer_disconnected':
				// Handle remote server disconnected event
				break;
			case 'remoteServer_error_connect':
				// Handle remote server connection error
				break;
			default:
				this.logger.error(`未知事件: ${event}`);
		}
	}

	isRegistered2SignalServer() {
		return this.client_registered;
	}

	isPeerConnected() {
		return this.peer_connected;
	}

	createPeer() {
		this.peerOffer = new WebRTC(this.logger, 'client_peer', config.ICEServer);

		this.peerOffer.on('peer_closed', async () => {
			this.logger.info(`Peer 关闭`);
			// await this.close()
			this.peer_connected = false
		});

		this.peerOffer.on('signal_description', signalData => {
			this.logger.debug('生成 peerOffer')
			this.signalClient.client_send_signal({
				event: 'client_signal_description',
				uuid: this.uuid,
				server: this.server,
				buf: signalData
			});
		});

		this.peerOffer.on('signal_candidate', signalData => {
			if (!this.signalClient) {
				return
			}
			// 匹配需要排除的地址
			if(!config.excludeCandidatePair.serverOnly){
				const data = signalData.candidate.split(' ');
				for(const li of config.excludeCandidatePair.list){
					if(li.test(data[4])){
						this.logger.debug(`排除本地候选: ${signalData.candidate} -- ${signalData.mid}`);
						return;
					}
				}
			}
			this.logger.debug(`本地候选: ${signalData.candidate} -- ${signalData.mid}`);
			this.signalClient.client_send_signal({
				event: 'client_signal_candidate',
				uuid: this.uuid,
				server: this.server,
				buf: signalData
			});
		});

		this.peerOffer.on('error', error => {
			this.logger.error(error);
			this.peer_connected = false
		});

		this.peerOffer.on('peer_connected', () => {
			this.peer_connected = true;
			this.logger.debug(`Peer 连接: Client[${this.uuid}]`);
		});

		this.peerOffer.on('channel_connected', (channel) => {
			this.logger.debug(`通道连接: Channel[${channel}]`);
		});

		this.peerOffer.on('channel_closed', (channel) => {
			this.logger.debug(`通道关闭: Channel[${channel}]`);
		});

		this.peerOffer.on('data', ({ label, data }) => { // data: Buffer
			let channel = label
			// this.logger.mark(`client side, received channel:${channel}, data:${data}`)
			if (channel in this.subClientDict) { // don't send after local socket closed.
				try {
					// this.logger.info(`wrtc -> client`);
					this.subClientDict[channel].subClientSocket.write(data);
				} catch (e) {
					this.logger.error(`写入本地通道 Socket 时出错: Channel[${channel}]`);
				}
			}
		});

		this.peerOffer.createDefaultDataChannel();
	}
	async sendMsg2Server(buf) {
		this.signalClient.client_send_signal({
			event: 'clientMsg',
			uuid: this.uuid,
			server: this.server,
			buf,
		});
	}
	async close() {
		if (this.peerOffer) {
			this.logger.info('关闭 peerOffer...')
			await this.peerOffer.close()
			this.peerOffer = null
			this.logger.info('peerOffer 已关闭')
		}
		if (this.server) {
			this.logger.info('关闭本地 socket 服务器...')
			this.net.close()
			this.net = null
			this.logger.info('本地 socket 服务器已关闭')
		}
		if (this.signalClient) {
			this.logger.info('关闭 signal 客户端...')
			this.signalClient.close()
			this.signalClient = null
			this.logger.info('Signal 客户端已关闭')
		}
	}
}
